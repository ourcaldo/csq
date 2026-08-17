import { z, type ZodTypeAny } from "zod";

// Best-effort Zod → JSON Schema converter for the OpenClaw function-tools
// payload. The JSON Schema only GUIDES the model; the real validation is
// server-side Zod inside executeTool, so an imperfect schema is safe — unknown
// nodes fall back to a permissive `{}`.
//
// No `as` assertions: every Zod subtype is narrowed with `instanceof`, after
// which its PUBLIC accessor (`.element`, `.shape`, `.options`, `.value`,
// `.enum`, `.unwrap()`, `.removeDefault()`) is typed by Zod's own d.ts.
// ZodIntersection is the one type with no public left/right accessor, so its
// typed `_def` (ZodIntersectionDef.left/right) is used directly.

export type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema);
}

function isOptional(node: ZodTypeAny): boolean {
  return node instanceof z.ZodOptional || node instanceof z.ZodDefault;
}

function convert(node: ZodTypeAny): JsonSchema {
  if (node instanceof z.ZodString) return { type: "string" };
  if (node instanceof z.ZodNumber) return { type: "number" };
  if (node instanceof z.ZodBoolean) return { type: "boolean" };
  if (node instanceof z.ZodLiteral) return { const: node.value };
  if (node instanceof z.ZodEnum) return { enum: node.options };
  if (node instanceof z.ZodNativeEnum) {
    return { enum: Object.values(node.enum) };
  }
  if (node instanceof z.ZodArray) {
    return { type: "array", items: convert(node.element) };
  }
  if (node instanceof z.ZodObject) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(node.shape)) {
      // Object.entries on a ZodObject<any,…> .shape yields `unknown` (the
      // generic shape loosens to any); narrow with instanceof instead of a
      // cast so convert/isOptional receive a real ZodTypeAny.
      if (!(value instanceof z.ZodType)) continue;
      properties[key] = convert(value);
      if (!isOptional(value)) required.push(key);
    }
    const schema: JsonSchema = { type: "object", properties };
    if (required.length) schema.required = required;
    return schema;
  }
  if (node instanceof z.ZodOptional) return convert(node.unwrap());
  if (node instanceof z.ZodDefault) return convert(node.removeDefault());
  if (node instanceof z.ZodNullable) {
    return { anyOf: [convert(node.unwrap()), { type: "null" }] };
  }
  if (node instanceof z.ZodUnion) {
    return { anyOf: node.options.map(convert) };
  }
  if (node instanceof z.ZodIntersection) {
    return { allOf: [convert(node._def.left), convert(node._def.right)] };
  }
  if (node instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: convert(node.element) };
  }
  return {}; // permissive fallback — server-side Zod is the real validator
}
