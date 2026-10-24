/** Request validation against the bundled JSON Schema (owner: M2). Same schema the engine's pydantic models come from. */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@dia/types/schema";
import { HTTPException } from "hono/http-exception";

const ajv = new Ajv2020({ strict: false, allErrors: true, useDefaults: true });
addFormats(ajv);
ajv.addSchema(schema);

/** Validate `data` against `#/$defs/<def>`; applies schema defaults; throws HTTP 422 on failure. */
export function validate<T>(def: string, data: unknown): T {
  const check = ajv.getSchema(`dia#/$defs/${def}`);
  if (!check) throw new Error(`unknown schema definition ${def}`);
  if (!check(data)) {
    const detail = (check.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    throw new HTTPException(422, { message: `invalid ${def}: ${detail}` });
  }
  return data as T;
}
