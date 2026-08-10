/**
 * Catalog of the Google Health OAuth scopes this app can ask a user for.
 *
 * Google's console lists these in their abbreviated form (`.../auth/
 * googlehealth.sleep.readonly`); `.../auth/` is shorthand for
 * `https://www.googleapis.com/auth/`, which is what actually has to travel in
 * the authorization URL. They are built from `SCOPE_PREFIX` here rather than
 * spelled out twenty-one times, so a typo in one of them is not possible.
 *
 * Read and write are separate grants: a `.readonly` scope never implies its
 * `.writeonly` sibling, and `.writeonly` only covers rows *this* client wrote —
 * it grants no read access and no control over data other apps contributed.
 *
 * This module is pure data. Keep it free of imports so both the browser bundle
 * and the server can use it.
 */

/** Prefix Google expands `.../auth/` to. */
const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth.";

export type GoogleHealthAccessLevel = "read" | "write";

export interface GoogleHealthDataType {
	/**
	 * Scope suffix, e.g. `activity_and_fitness`. Doubles as the stable React key
	 * and as the id the UI groups its read/write pair under.
	 */
	id: string;
	/** Short label for the UI. */
	label: string;
	/** What the data actually is, in one line. */
	description: string;
	/**
	 * Whether Google exposes a `.writeonly` scope for this data type.
	 *
	 * Three do not: ECG traces, irregular-rhythm notifications and app settings
	 * are produced by Google Health itself and are readable only.
	 */
	writable: boolean;
}

/**
 * Every Google Health data type, in the order Google's consent screen lists
 * them. Adding an entry here is all it takes to offer a new scope.
 */
export const GOOGLE_HEALTH_DATA_TYPES: readonly GoogleHealthDataType[] = [
	{
		id: "activity_and_fitness",
		label: "Activity and fitness",
		description: "Workouts, steps, active minutes and other fitness records.",
		writable: true,
	},
	{
		id: "health_metrics_and_measurements",
		label: "Health metrics and measurements",
		description:
			"Vitals and body measurements such as heart rate, blood pressure and weight.",
		writable: true,
	},
	{
		id: "location",
		label: "Workout location",
		description: "GPS traces recorded during a workout.",
		writable: true,
	},
	{
		id: "nutrition",
		label: "Nutrition",
		description: "Food, hydration and nutrient intake records.",
		writable: true,
	},
	{
		id: "sleep",
		label: "Sleep",
		description: "Sleep sessions and the stages within them.",
		writable: true,
	},
	{
		id: "reproductive_health",
		label: "Reproductive health",
		description: "Menstrual cycle, fertility and related records.",
		writable: true,
	},
	{
		id: "logged_symptoms",
		label: "Logged symptoms",
		description: "Symptoms the user has recorded themselves.",
		writable: true,
	},
	{
		id: "mindfulness",
		label: "Mindfulness",
		description: "Meditation and other mindfulness sessions.",
		writable: true,
	},
	{
		id: "profile",
		label: "Profile",
		description:
			"Profile data such as date of birth, height and biological sex.",
		writable: true,
	},
	{
		id: "irn",
		label: "Irregular rhythm notifications",
		description: "Irregular heart rhythm notifications raised by a device.",
		writable: false,
	},
	{
		id: "ecg",
		label: "Electrocardiogram",
		description: "ECG recordings taken on a supported device.",
		writable: false,
	},
	{
		id: "settings",
		label: "Settings",
		description: "The user's Google Health app settings.",
		writable: false,
	},
];

/** Full scope URL for one data type at one access level. */
export function googleHealthScope(
	dataTypeId: string,
	access: GoogleHealthAccessLevel,
): string {
	return `${SCOPE_PREFIX}${dataTypeId}.${
		access === "read" ? "readonly" : "writeonly"
	}`;
}

/** The scopes a single data type offers: read first, then write when it exists. */
export function googleHealthScopesFor(
	dataType: GoogleHealthDataType,
): readonly string[] {
	const scopes = [googleHealthScope(dataType.id, "read")];
	if (dataType.writable) scopes.push(googleHealthScope(dataType.id, "write"));
	return scopes;
}

/** Every scope in the catalog. This is what the authorize button asks for. */
export const GOOGLE_HEALTH_SCOPES: readonly string[] =
	GOOGLE_HEALTH_DATA_TYPES.flatMap((dataType) =>
		googleHealthScopesFor(dataType),
	);

/**
 * Whether `scope` is one of Google Health's.
 *
 * A linked Google account's stored scope list also holds the sign-in scopes
 * (`openid`, `email`, `profile`), so counting what the user granted means
 * filtering those out first.
 */
export function isGoogleHealthScope(scope: string): boolean {
	return scope.startsWith(SCOPE_PREFIX);
}

/**
 * Whether `grantedScopes` covers the entire catalog.
 *
 * This is the one definition of "fully authorized", and it is deliberately set
 * containment against `GOOGLE_HEALTH_SCOPES` rather than a count: the catalog
 * is the moving part, so adding a data type to it flips existing users back to
 * not-fully-authorized until they re-consent — which is exactly what should
 * put the Google Health tab, not the API key, in front of them again.
 */
export function hasAllGoogleHealthScopes(
	grantedScopes: readonly string[],
): boolean {
	const granted = new Set(grantedScopes);
	return GOOGLE_HEALTH_SCOPES.every((scope) => granted.has(scope));
}
