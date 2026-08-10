/**
 * Identity, contact and retention facts the legal documents are built from.
 *
 * Everything here is rendered verbatim into `/privacy` and `/terms`, and
 * Google's OAuth verification review cross-checks it against the Cloud Console
 * entry: the policy has to sit on the same origin as the app, name the same
 * operator, and give a contact address that actually answers. Keeping the facts
 * in one place means a change is one edit rather than a search across two long
 * documents — and, more importantly, that the two documents cannot disagree
 * with each other about a retention period or a deletion deadline.
 *
 * Dates are written out in full rather than derived from `Date`, because a
 * document's effective date is a fact about when it was published, not about
 * when the page happens to be rendered.
 *
 * This module is pure data. Keep it free of imports so both the browser bundle
 * and the server can use it.
 */

/**
 * The two halves of the brand.
 *
 * They exist as separate constants because the site header renders them as a
 * stacked lockup — the product on one line, the publisher under it — while
 * every other surface wants the two joined. Joining them happens once, in
 * `appName` below, so no page can invent its own spelling of the lockup.
 */
const PRODUCT_NAME = "GHealth Connector";
const VENDOR_NAME = "StillWarm.app";

export const LEGAL = {
	/** The product alone, without the publisher. Only the header wants this. */
	productName: PRODUCT_NAME,
	/** Who publishes the product. Also the domain it is served from. */
	vendorName: VENDOR_NAME,
	/**
	 * The full brand: what the app calls itself in prose, in page titles and to
	 * an MCP client.
	 *
	 * The Google OAuth consent screen is configured by hand in the Cloud Console
	 * rather than from here, and verification review reads the two side by side —
	 * so the name entered there has to stay identical to this one.
	 */
	appName: `${PRODUCT_NAME} by ${VENDOR_NAME}`,
	/** Canonical origin. The policy URLs Google is given must live under it. */
	siteUrl: "https://www.stillwarm.app",
	/** Who operates the service, as it should read inside a sentence. */
	operator: "Bestony",
	/** How the operator is constituted — this is what "we" refers to. */
	operatorDescription: "an individual developer",
	/** Where the operator is established. Governing law follows from this. */
	operatorLocation: "the People's Republic of China (Mainland China)",
	/** Address for privacy questions, data exports and deletion requests. */
	contactEmail: "bestony@linux.com",
	/** When the current text takes effect. */
	effectiveDate: "August 10, 2026",
	/** When the current text was last changed. */
	lastUpdated: "August 10, 2026",
	/** Rendered in the site footer; a constant keeps SSR and hydration in step. */
	copyrightYear: 2026,
} as const;

/**
 * How long each kind of data is kept.
 *
 * Both documents quote these, and a deletion request is measured against them,
 * so they are numbers rather than prose.
 */
export const LEGAL_RETENTION = {
	/** Deadline for honouring an account or data deletion request. */
	deletionRequestDays: 30,
	/** Extra window before encrypted backups holding deleted data roll off. */
	backupPurgeDays: 30,
	/** How long request and error logs are kept before they are discarded. */
	serverLogDays: 30,
} as const;

/**
 * External URLs both documents cite.
 *
 * Grouped here so a link that Google moves is fixed once. The Limited Use
 * anchor in particular is the one a reviewer follows to check the required
 * disclosure, so it points at the specific section rather than the page.
 */
export const LEGAL_LINKS = {
	/** Where a user revokes this app's access to their Google account. */
	googlePermissions: "https://myaccount.google.com/permissions",
	googleUserDataPolicy:
		"https://developers.google.com/terms/api-services-user-data-policy",
	googleLimitedUse:
		"https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes",
	googlePrivacyPolicy: "https://policies.google.com/privacy",
	googleTakeout: "https://takeout.google.com",
	modelContextProtocol: "https://modelcontextprotocol.io",
} as const;

/** `mailto:` target for the contact address, used by both documents. */
export const LEGAL_CONTACT_MAILTO = `mailto:${LEGAL.contactEmail}`;
