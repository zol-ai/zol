import "server-only";

/**
 * Server-side configuration. Nothing here is ever imported into a client
 * component — the `server-only` guard turns that into a build error rather
 * than a leaked key.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Throws at call time, not import time, so a missing key can't break the build. */
function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function flag(name: string): boolean {
  return optional(name)?.toLowerCase() === "true";
}

/**
 * A positive integer, or the fallback.
 *
 * Not `Number(...)`: that turns a typo'd value into NaN, and NaN slips through
 * every `>` guard downstream — a page-size ceiling compared against NaN stops
 * being a ceiling at all. A throw would be worse still, since these evaluate
 * at module load and would take down every route that imports this file. The
 * typo costs the operator their override, never the bound.
 */
function positiveInt(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const env = {
  /**
   * Telephony stays off until Twilio's carrier registration (A2P 10DLC brand
   * and campaign vetting, plus the voice CNAM/toll-free steps) is approved.
   * Until this is `true` the webhooks refuse to transact — failing closed is
   * the point: an unregistered number that answers calls is the compliance
   * problem we're waiting to clear.
   */
  telephonyEnabled: flag("ZOL_TELEPHONY_ENABLED"),

  twilio: {
    /** Used to verify that a webhook genuinely came from Twilio. */
    get authToken() {
      return required("TWILIO_AUTH_TOKEN");
    },
    get accountSid() {
      return required("TWILIO_ACCOUNT_SID");
    },
    /** The shop-facing number, once a registered one exists. */
    phoneNumber: optional("TWILIO_PHONE_NUMBER"),
  },

  openai: {
    get apiKey() {
      return required("OPENAI_API_KEY");
    },
    /** Overridable so a model swap is a deploy, not a code change. */
    model: optional("OPENAI_MODEL") ?? "gpt-4o",
    transcribeModel: optional("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1",
  },

  database: {
    url: optional("DATABASE_URL"),
    /**
     * `project:region:instance`. When set, `lib/db.ts` dials Cloud SQL through
     * the Node connector instead of `url` — the only path that works from
     * Vercel, whose egress IP changes too often to allowlist.
     */
    instanceConnectionName: optional("INSTANCE_CONNECTION_NAME"),
    get configured() {
      return Boolean(this.url ?? this.instanceConnectionName);
    },
  },

  /**
   * Public origin, used to rebuild the exact URL Twilio signed. Behind Cloud
   * Run and Vercel the request host can be a proxy host, and a mismatch here
   * silently fails every signature check.
   */
  publicUrl: optional("ZOL_PUBLIC_URL"),

  /** Waitlist events out to Company OS, and the sweeper that sends them. */
  companyOs: {
    /**
     * Company OS's Cloud Run origin. Two jobs at once: where the event goes,
     * and the `audience` claim baked into the ID token that authenticates it.
     * The receiver compares that claim against its own URL exactly, so a
     * trailing slash or the wrong host is a 401 rather than a routing error.
     */
    get url() {
      return required("COMPANY_OS_URL");
    },
    /** Present without throwing, for the health probe. */
    get configured() {
      return Boolean(optional("COMPANY_OS_URL"));
    },
    /**
     * How far back the sweeper looks. A ceiling, not a retention policy: a row
     * that has failed for this long needs a person, and retrying it forever
     * would bury the failure under identical log lines. Rows past it stay in
     * the table with delivered_at still null, which is the signal.
     */
    sweepWindowDays: positiveInt("COMPANY_OS_SWEEP_WINDOW_DAYS", 7),
    /** Rows per sweep. Bounds one Cloud Run request, not the backlog. */
    sweepBatchSize: positiveInt("COMPANY_OS_SWEEP_BATCH_SIZE", 50),
    /**
     * The service account Cloud Scheduler presents when it calls the sweeper.
     *
     * The sweeper is a public URL on a public Cloud Run service; without this
     * anybody could drive it. Unset means the endpoint refuses every request
     * rather than running unauthenticated — the failure of a misconfigured
     * deploy should be "nothing is delivered", never "anyone can trigger it".
     */
    schedulerServiceAccount: optional("COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT"),
    /**
     * The audience Cloud Scheduler was told to mint its token for — this
     * service's own sweeper URL, path included.
     *
     * No fallback, on purpose. An earlier draft fell back to ZOL_PUBLIC_URL,
     * which is structurally an origin and can never equal an audience that
     * carries the /api/waitlist/sweep path — so the fallback could only ever
     * produce a mismatch that 401s with a log line blaming the token instead
     * of the missing variable. Unset now names itself.
     */
    get sweepAudience() {
      return optional("COMPANY_OS_SWEEP_AUDIENCE");
    },
  },

  /**
   * `GET /api/waitlist/entries` — the reconciliation window onto the queue.
   *
   * A different caller from the sweeper's, and so a different allowlist.
   * Cloud Scheduler calls *into* the sweeper; Company OS calls into this. They
   * are separate identities and collapsing them into one variable would let
   * either service do the other's job.
   */
  waitlistRead: {
    /**
     * Service accounts allowed to read the queue. Company OS's runtime
     * identity, normally. Unset means nobody: an endpoint that hands out every
     * waitlist entry must not be one bad deploy away from being public.
     */
    allowedServiceAccounts: optional("WAITLIST_READ_ALLOWED_SERVICE_ACCOUNTS"),
    /**
     * The audience the caller mints for. This service's own origin — so the
     * ZOL_PUBLIC_URL fallback is correct here, unlike the sweeper's, whose
     * audience carries a path.
     */
    get audience() {
      return optional("WAITLIST_READ_AUDIENCE") ?? optional("ZOL_PUBLIC_URL");
    },
    /** Rows per page, and the ceiling a caller may ask for. */
    defaultPageSize: positiveInt("WAITLIST_READ_PAGE_SIZE", 100),
    maxPageSize: positiveInt("WAITLIST_READ_MAX_PAGE_SIZE", 500),
    /**
     * The floor of the reconciliation window — rows whose `updated_at`
     * predates this are never returned, whatever the caller asks for.
     *
     * This is what keeps migration 0005's one deliberate exclusion
     * enforceable. That migration stamped every pre-integration row
     * `delivered_at = now()` to mark it out of scope, but the read endpoint
     * cannot see the difference between "out of scope" and "delivered" — and
     * reconciliation deliberately ignores `delivered_at`, because rows the
     * sweeper's window aged out are exactly what it exists to catch. Without a
     * floor, one empty-body reconcile run would replay the entire back
     * catalogue into Company OS.
     *
     * Set it to the moment migration 0005 ran. A pre-integration row that
     * resubmits rises above the floor on its own, because the upsert moves
     * `updated_at` — which is correct: the resubmission puts it in scope.
     *
     * Required. The endpoint refuses to serve without it.
     */
    minUpdatedAt: optional("WAITLIST_READ_MIN_UPDATED_AT"),
  },
} as const;
