import { writeFileSync } from "node:fs";

/**
 * Regenerates `src/lib/google-health-api.gen.ts` from Google's discovery
 * document.
 *
 *   pnpm google-health:generate
 *
 * The discovery document is the only authoritative description of this API's
 * wire shapes, and it changes without warning. Hand-writing 147 interfaces
 * would guarantee they drift; generating them means a Google change shows up as
 * a diff in review instead of as a runtime surprise.
 *
 * What is emitted is deliberately narrow: schema types, and a catalog of the
 * data point types with the shape of the time field each one carries. Nothing
 * about *how* to call the API is generated — that lives in
 * `google-health-api.server.ts`, hand-written, because the useful ergonomics
 * are exactly the parts the discovery document does not describe.
 */

const DISCOVERY_URL = "https://health.googleapis.com/$discovery/rest?version=v4";
const OUTPUT = "src/lib/google-health-api.gen.ts";

/** Subset of the discovery document this script reads. */
interface DiscoveryProperty {
	$ref?: string;
	type?: string;
	format?: string;
	description?: string;
	enum?: string[];
	enumDescriptions?: string[];
	items?: DiscoveryProperty;
	additionalProperties?: DiscoveryProperty;
}

interface DiscoverySchema {
	id: string;
	description?: string;
	properties?: Record<string, DiscoveryProperty>;
}

interface DiscoveryMethod {
	scopes?: string[];
}

interface DiscoveryResource {
	methods?: Record<string, DiscoveryMethod>;
	resources?: Record<string, DiscoveryResource>;
}

interface Discovery {
	revision?: string;
	version: string;
	rootUrl: string;
	schemas: Record<string, DiscoverySchema>;
	resources: Record<string, DiscoveryResource>;
}

/**
 * Which time field a data point actually carries.
 *
 * Read off the schema rather than off the prose, because this is what decides
 * whether a filter may say `X.interval.start_time` or `X.date` — an expression
 * naming a field the schema does not have cannot resolve. It disagrees with the
 * prose in one case (`activity-level` is described as a daily collection but
 * carries an interval), and the schema is the one the server enforces.
 */
type TimeShape = "interval" | "sample" | "daily" | "none";

function timeShape(schema: DiscoverySchema | undefined): TimeShape {
	const keys = new Set(Object.keys(schema?.properties ?? {}));
	if (keys.has("interval")) return "interval";
	if (keys.has("sampleTime")) return "sample";
	if (keys.has("date")) return "daily";
	return "none";
}

/**
 * The collection id and kind Google states in each union member's description,
 * e.g. "Data for points in the `daily-resting-heart-rate` daily data type
 * collection."
 *
 * This is the only place the discovery document spells the id that goes in a
 * resource path, and it is worth mining rather than guessing: the path is
 * kebab-case (`daily-resting-heart-rate`) while filters are proto-case
 * (`daily_resting_heart_rate`), so a single derived spelling would be wrong in
 * one of the two places.
 */
const COLLECTION_PATTERN =
	/`([a-z0-9-]+)`\s+(interval|sample|daily|session)\s+data type collection/;

/** `daily-resting-heart-rate` → `daily_resting_heart_rate`. */
function toFilterId(pathId: string): string {
	return pathId.replaceAll("-", "_");
}

/** Wraps `text` as a JSDoc block at `indent`, or returns "" when there is none. */
function docComment(text: string | undefined, indent: string): string {
	if (!text) return "";
	const words = text.replace(/\s+/g, " ").trim().split(" ");
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (line.length + word.length + 1 > 76 - indent.length) {
			lines.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) lines.push(line);

	return `${indent}/**\n${lines
		.map((l) => `${indent} * ${l}`)
		.join("\n")}\n${indent} */\n`;
}

/**
 * A property's TypeScript type.
 *
 * The format mappings are not cosmetic. Google encodes 64-bit integers as JSON
 * strings because a `number` cannot hold them, and durations arrive as `"3.5s"`
 * rather than as a count — typing either as `number` would produce code that
 * looks right and is wrong.
 */
function tsType(property: DiscoveryProperty): string {
	if (property.$ref) return property.$ref;
	if (property.enum) {
		return property.enum.map((value) => `"${value}"`).join(" | ");
	}

	switch (property.type) {
		case "array":
			return property.items ? `${tsType(property.items)}[]` : "unknown[]";
		case "object":
			return property.additionalProperties
				? `Record<string, ${tsType(property.additionalProperties)}>`
				: "Record<string, unknown>";
		case "boolean":
			return "boolean";
		case "number":
			return "number";
		case "integer":
			// int64 arrives as a string; only the 32-bit formats fit a number.
			return property.format === "int64" || property.format === "uint64"
				? "string"
				: "number";
		case "string":
			return "string";
		default:
			return "unknown";
	}
}

/** A one-line note about a format that the type alone does not convey. */
function formatNote(property: DiscoveryProperty): string {
	switch (property.format) {
		case "int64":
		case "uint64":
			return "64-bit integer, sent as a decimal string.";
		case "google-datetime":
			return "RFC 3339 timestamp, e.g. `2026-08-10T12:34:56Z`.";
		case "google-duration":
			return 'Duration with a unit suffix, e.g. `"3.5s"`.';
		case "byte":
			return "Base64-encoded bytes.";
		default:
			return "";
	}
}

function renderInterface(schema: DiscoverySchema): string {
	// Sorted, because the discovery endpoint does not promise a stable key order
	// and this file is committed: without it, regenerating produces a diff of
	// reordered fields that hides the one field Google actually changed.
	const properties = Object.entries(schema.properties ?? {}).sort(([a], [b]) =>
		a.localeCompare(b),
	);

	if (properties.length === 0) {
		// `interface X {}` is an object with no known keys, which is not what an
		// empty proto message means and is a lint error besides.
		return `${docComment(schema.description, "")}export type ${schema.id} = Record<string, never>;`;
	}

	const body = properties
		.map(([name, property]) => {
			const note = formatNote(property);
			const description = [property.description, note]
				.filter(Boolean)
				.join(" ");
			const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : `"${name}"`;
			// Every field is optional: proto3 JSON omits defaults, so anything the
			// user has not recorded is simply absent from the response.
			return `${docComment(description, "\t")}\t${key}?: ${tsType(property)};`;
		})
		.join("\n");

	return `${docComment(schema.description, "")}export interface ${schema.id} {\n${body}\n}`;
}

async function main(): Promise<void> {
	const response = await fetch(DISCOVERY_URL);
	if (!response.ok) {
		throw new Error(
			`Could not fetch the discovery document: ${response.status} ${response.statusText}`,
		);
	}
	const discovery = (await response.json()) as Discovery;

	const schemas = Object.values(discovery.schemas).sort((a, b) =>
		a.id.localeCompare(b.id),
	);

	// The union members of `DataPoint` are the data types; everything else on it
	// is bookkeeping.
	const dataPoint = discovery.schemas.DataPoint;
	if (!dataPoint?.properties) {
		throw new Error("The discovery document has no DataPoint schema");
	}

	const catalog = Object.entries(dataPoint.properties)
		.filter(([, property]) => Boolean(property.$ref))
		.map(([field, property]) => {
			const ref = property.$ref as string;
			const match = COLLECTION_PATTERN.exec(property.description ?? "");
			return {
				field,
				ref,
				pathId: match?.[1],
				collection: match?.[2],
				shape: timeShape(discovery.schemas[ref]),
			};
		})
		// Members with no collection id are reference data, not recordings:
		// `dataSource`, `food` and `foodMeasurementUnit` describe other points
		// rather than being points themselves.
		.filter((entry) => entry.pathId !== undefined && entry.shape !== "none")
		.sort((a, b) => (a.pathId as string).localeCompare(b.pathId as string));

	const catalogEntries = catalog
		.map((entry) =>
			[
				"\t{",
				`\t\tid: "${entry.pathId}",`,
				`\t\tfield: "${entry.field}",`,
				`\t\tschema: "${entry.ref}",`,
				`\t\tfilterId: "${toFilterId(entry.pathId as string)}",`,
				`\t\tcollection: "${entry.collection}",`,
				`\t\tshape: "${entry.shape}",`,
				"\t},",
			].join("\n"),
		)
		.join("\n");

	const idUnion = catalog.map((entry) => `\t| "${entry.pathId}"`).join("\n");

	// The scopes `dataPoints.list` accepts are the whole answer to "what can be
	// read at all". There are fewer of them than there are consent categories:
	// nutrition, reproductive health, logged symptoms and mindfulness have a
	// `.writeonly` scope and no `.readonly` one, so in v4 they can be written and
	// never read back. Emitting the list rather than writing it down means a
	// fifth readable category arrives with a regeneration instead of going
	// unnoticed.
	const listScopes =
		discovery.resources.users?.resources?.dataTypes?.resources?.dataPoints
			?.methods?.list?.scopes ?? [];

	if (listScopes.length === 0) {
		throw new Error(
			"dataPoints.list declares no scopes; the discovery document changed shape",
		);
	}

	const readScopes = [...listScopes]
		.sort()
		.map((scope) => `\t"${scope}",`)
		.join("\n");

	const header = `// GENERATED by \`pnpm google-health:generate\`. Do not edit by hand.
//
// Source:   ${DISCOVERY_URL}
// Version:  ${discovery.version}
// Revision: ${discovery.revision ?? "unknown"}
//
// Every field is optional because proto3 JSON omits defaults: a field the user
// has never recorded is absent from the response rather than null. Consumers
// have to narrow, which is the honest shape of this API.

/** Base URL of the API these types describe. */
export const GOOGLE_HEALTH_ROOT_URL = "${discovery.rootUrl}";

/** API version these types were generated from. */
export const GOOGLE_HEALTH_API_VERSION = "${discovery.version}";

/**
 * Which time field a data point carries, and therefore what a filter on it may
 * name.
 *
 * - \`interval\` — a start and an end (\`steps\`, \`sleep\`, \`exercise\`).
 * - \`sample\`   — a reading at an instant (\`weight\`, \`heart-rate\`).
 * - \`daily\`    — one value for a calendar day (\`daily-resting-heart-rate\`).
 */
export type GoogleHealthTimeShape = "interval" | "sample" | "daily";

/**
 * The kind of collection Google files a data type under.
 *
 * Mostly agrees with the time shape, and where it does not, the shape is what
 * a filter has to follow. It is kept because \`session\` is the group whose
 * filters have their own rules.
 */
export type GoogleHealthCollectionKind =
	| "interval"
	| "sample"
	| "daily"
	| "session";

/** Every data type id that can appear in a resource path. */
export type GoogleHealthDataTypeId =
${idUnion};

export interface GoogleHealthDataPointType {
	/** Path segment: \`users/me/dataTypes/{id}\`. Kebab-case. */
	id: GoogleHealthDataTypeId;
	/** Key on \`DataPoint\` carrying this type's payload. Camel-case. */
	field: string;
	/** Name of the schema behind that key. */
	schema: string;
	/** How the type is named inside a filter expression. Snake-case. */
	filterId: string;
	collection: GoogleHealthCollectionKind;
	shape: GoogleHealthTimeShape;
}

/**
 * Every data type \`DataPoint\` can carry.
 *
 * Note the three spellings of the same type — \`daily-resting-heart-rate\` in a
 * path, \`dailyRestingHeartRate\` on a \`DataPoint\`, \`daily_resting_heart_rate\`
 * in a filter. Getting one of them wrong is a 404 or an empty page rather than
 * an error worth reading, which is the whole reason this table exists.
 *
 * Union members with no collection id (\`dataSource\`, \`food\`,
 * \`foodMeasurementUnit\`) are reference data rather than recordings and are
 * left out.
 */
export const GOOGLE_HEALTH_DATA_POINT_TYPES: readonly GoogleHealthDataPointType[] =
	[
${catalogEntries}
	];

/**
 * The scopes \`users.dataTypes.dataPoints.list\` accepts — which is to say,
 * everything this API can read.
 *
 * Shorter than the consent screen's list of categories, and deliberately so:
 * nutrition, reproductive health, logged symptoms and mindfulness have a
 * \`.writeonly\` scope and no \`.readonly\` one, so their data can be written and
 * never read back. A tool that offers to read them would be offering something
 * the API cannot do.
 */
export const GOOGLE_HEALTH_READ_SCOPES: readonly string[] = [
${readScopes}
];
`;

	const body = schemas.map(renderInterface).join("\n\n");

	writeFileSync(OUTPUT, `${header}\n${body}\n`);

	console.log(
		`Wrote ${OUTPUT}: ${schemas.length} schemas, ${catalog.length} data point types (revision ${discovery.revision ?? "unknown"}).`,
	);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
