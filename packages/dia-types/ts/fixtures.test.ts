import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../dist/dia.schema.json";
import { FIXTURES } from "./index";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);

describe("fixtures satisfy the bundled schema", () => {
  for (const [name, def] of Object.entries(FIXTURES)) {
    test(name, () => {
      const data = JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", `${name}.json`), "utf8"));
      const isArray = def.endsWith("[]");
      const ref = `dia#/$defs/${def.replace("[]", "")}`;
      const validate = ajv.getSchema(ref)!;
      const items = isArray ? data : [data];
      for (const item of items) {
        const ok = validate(item);
        expect(ok ? [] : validate.errors).toEqual([]);
      }
    });
  }
});
