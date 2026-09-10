import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { randomSuffix, SLUG, slugify } from "./slug";

describe("slugify", () => {
  it("turns a shop name into a URL handle", () => {
    assert.equal(slugify("Fifth Street Auto"), "fifth-street-auto");
    assert.equal(slugify("  Reyes Bros. Garage & Tire  "), "reyes-bros-garage-tire");
    assert.equal(slugify("Peña's Auto"), "pena-s-auto");
  });

  it("always produces something the CHECK constraint accepts", () => {
    for (const name of ["Fifth Street Auto", "---", "A", "Ürün Servis", "X Y", "!!!"]) {
      const slug = slugify(name);
      assert.match(slug, SLUG, `${JSON.stringify(name)} → ${slug}`);
      assert.ok(slug.length >= 2);
    }
    assert.match(`${slugify("Main Street Auto")}-${randomSuffix()}`, SLUG);
  });

  it("caps the length", () => {
    const slug = slugify("A very long shop name that goes on and on and on and on and on");
    assert.ok(slug.length <= 48);
    assert.match(slug, SLUG);
  });
});
