"use client";

import {
  useActionState,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import { uploadAttachment } from "@/app/actions/attachments";
import type { FormState } from "@/app/actions/auth";
import { runDiagnostic, verifyDiagnostic } from "@/app/actions/diagnostics";
import { saveInspectionItem } from "@/app/actions/inspections";
import { addPart } from "@/app/actions/parts";
import {
  addLine,
  createRepairOrder,
  saveAssignment,
  saveRepairOrder,
} from "@/app/actions/repair-orders";
import { Field, FormError, Select, Submit } from "@/components/app/field";
import { RatingDot } from "@/components/app/ui";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  RATING_LABEL,
  RATINGS,
  type Priority,
  type Rating,
} from "@/lib/statuses";

/**
 * Every form on the repair order, in one client file.
 *
 * The panels that compose the ticket are server components — they run the
 * queries — and a form with field-level errors needs `useActionState`, which
 * is a client hook. So the panels render these. Each one is small on
 * purpose: one thing, saved, with the error next to the box that caused it,
 * because the person filling it in is standing under a car.
 */

export interface StaffOption {
  id: string;
  name: string;
}

export interface VehicleOption {
  id: string;
  label: string;
}

const TEXTAREA =
  "w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-3/70";

function Textarea({
  label,
  name,
  id: idProp,
  error,
  hint,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
}) {
  // Same rule as `Field`: the id follows the name unless two forms on one
  // page would collide, in which case the caller passes one.
  const id = idProp ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`${TEXTAREA} ${error ? "border-amber-deep" : ""}`}
        {...rest}
      />
      {error ? (
        <p className="text-[0.8125rem] text-amber-deep">{error}</p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Same look as `Field`, with the id separate from the name. `Field` keys its
 * id off the name, which is right for a page with one form and wrong for the
 * thirteen inspection items and the two "quantity" boxes that share this one.
 */
function LabelledInput({
  id,
  label,
  error,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-[var(--radius)] border bg-paper px-3 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-3/70 ${
          error ? "border-amber-deep" : "border-line-2"
        }`}
        {...input}
      />
      {error ? (
        <p className="text-[0.8125rem] text-amber-deep">{error}</p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Opening and editing the ticket
// -----------------------------------------------------------------------------

/** Opening a ticket. Complaint in the customer's words, and nothing else required. */
export function NewRepairOrderForm({
  customerId,
  vehicles,
  technicians,
  defaultVehicleId = null,
}: {
  customerId: string;
  vehicles: VehicleOption[];
  technicians: StaffOption[];
  /** Pre-selected when the ticket is opened from a vehicle's own page. */
  defaultVehicleId?: string | null;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    createRepairOrder,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="customer_id" value={customerId} />

      {vehicles.length > 0 && (
        <Select
          label="Vehicle"
          name="vehicle_id"
          defaultValue={state?.values?.vehicle_id ?? defaultVehicleId ?? undefined}
          error={state?.fields?.vehicle_id}
        >
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label}
            </option>
          ))}
          <option value="">Not sure yet</option>
        </Select>
      )}

      <Textarea
        label="Complaint"
        name="complaint"
        rows={3}
        required
        defaultValue={state?.values?.complaint}
        placeholder="Grinding from the front when braking, worse when cold"
        error={state?.fields?.complaint}
        hint="Their words, not a diagnosis."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Mileage in"
          name="mileage"
          inputMode="numeric"
          defaultValue={state?.values?.mileage}
          error={state?.fields?.mileage}
        />
        <Select
          label="Technician"
          name="technician_id"
          defaultValue={state?.values?.technician_id ?? ""}
          error={state?.fields?.technician_id}
        >
          <option value="">Not yet assigned</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.name}
            </option>
          ))}
        </Select>
        <Select
          label="Priority"
          name="priority"
          defaultValue={state?.values?.priority ?? "normal"}
          error={state?.fields?.priority}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABEL[priority]}
            </option>
          ))}
        </Select>
      </div>

      <Submit className="btn btn-emerald self-start">Open repair order</Submit>
    </form>
  );
}

export interface RepairOrderRecord {
  id: string;
  complaint: string | null;
  cause: string | null;
  correction: string | null;
  mileage_in: number | null;
}

/** The three C's and the mileage. What an advisor edits all day. */
export function RepairOrderForm({ ro }: { ro: RepairOrderRecord }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveRepairOrder,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="id" value={ro.id} />

      {/* Complaint, cause, correction — the three lines every shop writes on
          the ticket, and the three the agent has to fill in from a call. */}
      <Textarea
        name="complaint"
        label="Complaint"
        rows={2}
        defaultValue={ro.complaint ?? ""}
        hint="What they told you."
      />
      <Textarea
        name="cause"
        label="Cause"
        rows={2}
        defaultValue={ro.cause ?? ""}
        hint="What you found. A verified diagnostic fills this in when it's empty."
      />
      <Textarea
        name="correction"
        label="Correction"
        rows={2}
        defaultValue={ro.correction ?? ""}
        hint="What you did about it."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Mileage in"
          name="mileage"
          inputMode="numeric"
          defaultValue={ro.mileage_in ?? ""}
          error={state?.fields?.mileage}
        />
      </div>

      <Submit className="btn btn-emerald self-start">Save</Submit>
    </form>
  );
}

/**
 * Technician, priority, promised time. The two selects save themselves the
 * moment they change — one tap on a phone — and the promised time waits for
 * the button, because a half-typed date should not be written. Both submit
 * the same form, so the Save button carries `intent=promised` and
 * `saveAssignment` only reads the date box when it sees that flag: a
 * technician change posts whatever is in the box, and must not write it.
 */
export function AssignmentForm({
  repairOrderId,
  technicianId,
  priority,
  promisedAt,
  technicians,
}: {
  repairOrderId: string;
  technicianId: string | null;
  priority: Priority;
  /** "2026-09-10T15:30" in the shop's zone, or null. */
  promisedAt: string | null;
  technicians: StaffOption[];
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveAssignment,
    undefined,
  );

  return (
    <form
      action={action}
      className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="id" value={repairOrderId} />
      <div className="col-span-2 sm:col-span-1">
        <SelectOnChange
          label="Technician"
          name="technician_id"
          defaultValue={state?.values?.technician_id ?? technicianId ?? ""}
          error={state?.fields?.technician_id}
        >
          <option value="">Unassigned</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.name}
            </option>
          ))}
        </SelectOnChange>
      </div>
      <SelectOnChange
        label="Priority"
        name="priority"
        defaultValue={state?.values?.priority ?? priority}
        error={state?.fields?.priority}
      >
        {PRIORITIES.map((value) => (
          <option key={value} value={value}>
            {PRIORITY_LABEL[value]}
          </option>
        ))}
      </SelectOnChange>
      <Field
        label="Promised for"
        name="promised_at"
        type="datetime-local"
        defaultValue={state?.values?.promised_at ?? promisedAt ?? ""}
        error={state?.fields?.promised_at}
      />
      <div className="col-span-2 sm:col-span-1">
        <Submit
          className="btn btn-ghost btn-sm w-full sm:w-auto"
          pendingLabel="Saving…"
          name="intent"
          value="promised"
        >
          Save
        </Submit>
      </div>
      {state?.error && (
        <div className="col-span-2 sm:col-span-4">
          <FormError>{state.error}</FormError>
        </div>
      )}
    </form>
  );
}

/** A select that submits its form when it changes. Same look as `Select`. */
function SelectOnChange({
  label,
  name,
  defaultValue,
  error,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={`w-full rounded-[var(--radius)] border bg-paper px-3 py-2.5 text-[0.9375rem] text-ink ${
          error ? "border-amber-deep" : "border-line-2"
        }`}
      >
        {children}
      </select>
      {error && <p className="text-[0.8125rem] text-amber-deep">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Lines
// -----------------------------------------------------------------------------

/** Add a line. Labour is hours × rate; a part is count × price. */
export function AddLineForm({
  repairOrderId,
  laborRate,
}: {
  repairOrderId: string;
  /** "145.00" — the shop's rate, as dollars. */
  laborRate: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    addLine,
    undefined,
  );
  const [kind, setKind] = useState(state?.values?.kind ?? "labor");

  return (
    /*
      One row on a laptop. On a phone the two number boxes pair up rather than
      each taking a full line — adding four parts to a ticket was otherwise a
      long scroll.
    */
    <form
      action={action}
      className="grid grid-cols-2 gap-3 sm:grid-cols-[9rem_1fr_5rem_7rem_auto]"
    >
      {/*
        Ids are prefixed: the declined-work form further down the ticket also
        posts a `description`, and two boxes with one id send the label's
        click — and a screen reader's error text — to the wrong one.
      */}
      <div className="col-span-2 sm:col-span-1">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="line-kind" className="text-[0.8125rem] font-semibold text-ink-2">
            Kind
          </label>
          <select
            id="line-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value)}
            className="w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[0.9375rem] text-ink"
          >
            <option value="labor">Labour</option>
            <option value="part">Part</option>
            <option value="fee">Fee</option>
            <option value="discount">Discount</option>
          </select>
        </div>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <Field
          label="Description"
          name="description"
          id="line-description"
          required
          defaultValue={state?.values?.description}
          error={state?.fields?.description}
        />
      </div>
      <Field
        label={kind === "labor" ? "Hours" : "Qty"}
        name="quantity"
        id="line-quantity"
        inputMode="decimal"
        defaultValue={state?.values?.quantity ?? "1"}
        error={state?.fields?.quantity}
      />
      <Field
        label={kind === "labor" ? "Rate" : "Unit"}
        name="unit"
        id="line-unit"
        inputMode="decimal"
        required={kind !== "labor"}
        placeholder={kind === "labor" ? laborRate : "0.00"}
        defaultValue={state?.values?.unit}
        error={state?.fields?.unit}
        hint={kind === "labor" ? "Blank bills at your rate." : undefined}
      />
      <input type="hidden" name="repair_order_id" value={repairOrderId} />
      <div className="col-span-2 flex items-start sm:col-span-1 sm:pt-[1.625rem]">
        <Submit className="btn btn-ghost w-full sm:w-auto">Add</Submit>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------

export function DiagnosticForm({
  repairOrderId,
  aiConfigured,
}: {
  repairOrderId: string;
  aiConfigured: boolean;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    runDiagnostic,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="repair_order_id" value={repairOrderId} />

      <Field
        label="OBD codes"
        name="codes"
        placeholder="P0301 P0171"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        defaultValue={state?.values?.codes}
        error={state?.fields?.codes}
        hint="Space or comma separated. Leave empty if there are none."
      />
      <Textarea
        label="Symptoms"
        name="symptoms"
        rows={2}
        placeholder="Rough idle when cold, misfire counter climbing on cylinder 1"
        defaultValue={state?.values?.symptoms}
        error={state?.fields?.symptoms}
        hint="What the car does. Fuel trims and live data are worth a line."
      />
      <Textarea
        label="Observations"
        name="observations"
        rows={2}
        placeholder="Coil 1 heat-discoloured. Vacuum lines original. No exhaust leak audible."
        defaultValue={state?.values?.observations}
        error={state?.fields?.observations}
        hint="What you saw under the hood."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Submit className="btn btn-emerald self-start" pendingLabel="Ranking causes…">
          Rank the causes
        </Submit>
        <p className="text-[0.8125rem] text-ink-3">
          {aiConfigured
            ? "Ranked by the model from these facts. A technician verifies before anything is quoted."
            : "No model key on this deployment — ranked from ZOL's code-family guidance. A technician verifies before anything is quoted."}
        </p>
      </div>
    </form>
  );
}

export function VerifyDiagnosticForm({
  diagnosticId,
  repairOrderId,
  suggestion,
}: {
  diagnosticId: string;
  repairOrderId: string;
  /** The top-ranked cause, offered as a starting point — never written on its own. */
  suggestion: string | null;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    verifyDiagnostic,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="diagnostic_id" value={diagnosticId} />
      <input type="hidden" name="repair_order_id" value={repairOrderId} />
      <Textarea
        label="Technician verification"
        name="verification"
        rows={2}
        required
        placeholder={suggestion ? `Confirmed: ${suggestion.toLowerCase()} — …` : "What you confirmed on the car"}
        defaultValue={state?.values?.verification}
        error={state?.fields?.verification}
        hint="Your conclusion, in your words. It becomes the ticket's cause when that is still empty."
      />
      <Submit className="btn btn-emerald btn-sm self-start" pendingLabel="Saving…">
        Verify
      </Submit>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Inspection
// -----------------------------------------------------------------------------

export interface InspectionItemRecord {
  id: string;
  category: string;
  name: string;
  rating: Rating;
  measurement: string | null;
  notes: string | null;
}

/**
 * The four ratings as a segmented control: real radio buttons under styled
 * labels, so the keyboard, the screen reader and the browser's own form
 * reset all still work. The colour is the rating dot's colour.
 */
const RATING_CHECKED: Record<Rating, string> = {
  green: "peer-checked:border-emerald-line peer-checked:bg-emerald-wash peer-checked:text-emerald-deep",
  yellow: "peer-checked:border-amber-line peer-checked:bg-amber-wash peer-checked:text-amber-deep",
  red: "peer-checked:border-red-line peer-checked:bg-red-wash peer-checked:text-red-deep",
  not_inspected: "peer-checked:border-line-2 peer-checked:bg-paper-3 peer-checked:text-ink",
};

export function InspectionItemForm({
  item,
  repairOrderId,
  readOnly,
}: {
  item: InspectionItemRecord;
  repairOrderId: string;
  readOnly: boolean;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveInspectionItem,
    undefined,
  );
  const rating = (state?.values?.rating as Rating | undefined) ?? item.rating;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="item_id" value={item.id} />
      <input type="hidden" name="repair_order_id" value={repairOrderId} />

      <fieldset disabled={readOnly} className="min-w-0">
        <legend className="sr-only">{item.category} rating</legend>
        <div className="grid grid-cols-4 gap-1 rounded-[var(--radius)] bg-paper-2 p-1">
          {RATINGS.map((value) => (
            <label key={value} className="relative">
              <input
                type="radio"
                name="rating"
                value={value}
                defaultChecked={rating === value}
                className="peer sr-only"
              />
              <span
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border border-transparent px-1 py-1.5 text-[0.75rem] font-semibold text-ink-3 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-emerald ${RATING_CHECKED[value]}`}
              >
                <RatingDot rating={value} />
                <span className="truncate">{RATING_LABEL[value]}</span>
              </span>
            </label>
          ))}
        </div>
        {state?.fields?.rating && (
          <p className="mt-1 text-[0.8125rem] text-amber-deep">{state.fields.rating}</p>
        )}
      </fieldset>

      {!readOnly && (
        <div className="grid grid-cols-[7rem_1fr] gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-start">
          <LabelledInput
            id={`measurement-${item.id}`}
            name="measurement"
            label="Measurement"
            placeholder="4 mm"
            defaultValue={state?.values?.measurement ?? item.measurement ?? ""}
            error={state?.fields?.measurement}
          />
          <LabelledInput
            id={`notes-${item.id}`}
            name="notes"
            label="Notes"
            placeholder="Front pads at 4mm, rotors lipped"
            defaultValue={state?.values?.notes ?? item.notes ?? ""}
            error={state?.fields?.notes}
          />
          <div className="col-span-2 sm:col-span-1 sm:pt-[1.625rem]">
            <Submit className="btn btn-ghost btn-sm w-full sm:w-auto" pendingLabel="Saving…">
              Save
            </Submit>
          </div>
        </div>
      )}
    </form>
  );
}

export function UploadPhotoForm({
  repairOrderId,
  entityType,
  entityId,
}: {
  repairOrderId: string;
  entityType: "inspection_item" | "inspection" | "repair_order" | "vehicle" | "diagnostic";
  entityId: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    uploadAttachment,
    undefined,
  );
  const fileId = `file-${entityId}`;
  const captionId = `caption-${entityId}`;

  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="repair_order_id" value={repairOrderId} />
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-[0.8125rem] font-semibold text-ink-2">
            Photo
          </label>
          <input
            id={fileId}
            name="file"
            type="file"
            accept="image/*"
            capture="environment"
            required
            className="w-full text-[0.875rem] text-ink-2 file:mr-3 file:rounded-[var(--radius)] file:border file:border-line-2 file:bg-paper file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-semibold file:text-ink"
          />
          {state?.fields?.file && (
            <p className="text-[0.8125rem] text-amber-deep">{state.fields.file}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={captionId} className="text-[0.8125rem] font-semibold text-ink-2">
            Caption
          </label>
          <input
            id={captionId}
            name="caption"
            placeholder="Inner pad, driver side"
            defaultValue={state?.values?.caption}
            className="w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-3/70"
          />
          {state?.fields?.caption && (
            <p className="text-[0.8125rem] text-amber-deep">{state.fields.caption}</p>
          )}
        </div>
        <div className="sm:pt-[1.625rem]">
          <Submit className="btn btn-ghost btn-sm w-full sm:w-auto" pendingLabel="Uploading…">
            Upload
          </Submit>
        </div>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Parts
// -----------------------------------------------------------------------------

export interface PartLineOption {
  id: string;
  label: string;
}

export function AddPartForm({
  repairOrderId,
  lines,
  marginPct,
}: {
  repairOrderId: string;
  /** Part lines on the ticket a physical part can fulfil. */
  lines: PartLineOption[];
  /** The shop's parts margin, for the price hint. */
  marginPct: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    addPart,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="repair_order_id" value={repairOrderId} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <div className="col-span-2 sm:col-span-1">
          <LabelledInput
            id="part-name"
            name="name"
            label="Part"
            required
            placeholder="Front brake pads, ceramic"
            defaultValue={state?.values?.name}
            error={state?.fields?.name}
          />
        </div>
        <LabelledInput
          id="part-number"
          name="part_number"
          label="Part number"
          autoCapitalize="characters"
          defaultValue={state?.values?.part_number}
          error={state?.fields?.part_number}
        />
        <LabelledInput
          id="part-supplier"
          name="supplier"
          label="Supplier"
          placeholder="WorldPac"
          defaultValue={state?.values?.supplier}
          error={state?.fields?.supplier}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-[5rem_8rem_8rem_1fr]">
        <LabelledInput
          id="part-quantity"
          name="quantity"
          label="Qty"
          inputMode="numeric"
          defaultValue={state?.values?.quantity ?? "1"}
          error={state?.fields?.quantity}
        />
        <LabelledInput
          id="part-cost"
          name="unit_cost"
          label="Cost"
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={state?.values?.unit_cost}
          error={state?.fields?.unit_cost}
        />
        <LabelledInput
          id="part-price"
          name="unit_price"
          label="Price"
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={state?.values?.unit_price}
          error={state?.fields?.unit_price}
          hint={`Blank = cost + ${marginPct}%`}
        />
        <div className="col-span-3 sm:col-span-1">
          <LabelledInput
            id="part-expected"
            name="expected_at"
            label="Expected"
            type="datetime-local"
            defaultValue={state?.values?.expected_at}
            error={state?.fields?.expected_at}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {lines.length > 0 && (
          <Select
            label="Fulfils line"
            name="line_id"
            defaultValue={state?.values?.line_id ?? ""}
            error={state?.fields?.line_id}
          >
            <option value="">No line yet</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.label}
              </option>
            ))}
          </Select>
        )}
        <LabelledInput
          id="part-notes"
          name="notes"
          label="Notes"
          placeholder="Core charge applies"
          defaultValue={state?.values?.notes}
          error={state?.fields?.notes}
        />
      </div>

      <Submit className="btn btn-ghost self-start" pendingLabel="Adding…">
        Add part
      </Submit>
    </form>
  );
}
