import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Bullets,
	Callout,
	ContactEmail,
	createSectionRef,
	ExternalLink,
	LegalDocument,
	type LegalSection,
	Para,
	Steps,
	Subheading,
} from "../components/legal-document";
import { GOOGLE_HEALTH_DATA_TYPES } from "../lib/google-health-scopes";
import { LEGAL, LEGAL_LINKS, LEGAL_RETENTION } from "../lib/legal";

/**
 * Privacy Policy — the document Google's OAuth verification review reads.
 *
 * Three properties of this route are requirements, not choices:
 *
 * - It is public. There is no `beforeLoad` guard, because a reviewer opens the
 *   URL without an account and a policy behind a login is rejected.
 * - It is same-origin with the app and linked from the home page, which the
 *   site footer in `__root.tsx` takes care of.
 * - It carries the Limited Use disclosure — the `google-limited-use` section —
 *   close to verbatim. Google matches that wording; do not paraphrase it away.
 *
 * The facts it states must stay true of the code. The health data table is
 * generated from `GOOGLE_HEALTH_DATA_TYPES`, so adding a scope to the catalog
 * discloses it here automatically; retention periods come from `legal.ts` so
 * they cannot drift apart from the Terms.
 */

export const Route = createFileRoute("/privacy")({
	head: () => ({
		meta: [
			{ title: `Privacy Policy — ${LEGAL.appName}` },
			{
				name: "description",
				content: `How ${LEGAL.appName} collects, uses, stores and deletes your Google Health data.`,
			},
		],
	}),
	component: PrivacyPolicyPage,
});

/**
 * The Google Health categories this app can request, rendered from the same
 * catalog the consent screen is built from. A scope the app asks for is
 * therefore always a scope this policy discloses.
 */
function HealthDataTable() {
	return (
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-left text-sm">
				<thead>
					<tr className="border-b border-border">
						<th className="py-2 pr-4 font-semibold">Category</th>
						<th className="py-2 pr-4 font-semibold">What it contains</th>
						<th className="py-2 pr-4 font-semibold">Read</th>
						<th className="py-2 font-semibold">Write</th>
					</tr>
				</thead>
				<tbody>
					{GOOGLE_HEALTH_DATA_TYPES.map((dataType) => (
						<tr
							className="border-b border-border last:border-b-0"
							key={dataType.id}
						>
							<td className="py-2 pr-4 align-top font-medium">
								{dataType.label}
							</td>
							<td className="py-2 pr-4 align-top text-muted-foreground">
								{dataType.description}
							</td>
							<td className="py-2 pr-4 align-top">Yes</td>
							<td className="py-2 align-top">
								{dataType.writable ? "Yes" : "No"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Cross-references into `SECTIONS`, numbered from its order rather than by hand. */
const Ref = createSectionRef(() => SECTIONS);

const SECTIONS: readonly LegalSection[] = [
	{
		id: "summary",
		title: "Summary",
		body: (
			<>
				<Para>
					This summary is here so you do not have to read the whole document to
					know what happens to your data. It is not a substitute for the
					sections below, which control.
				</Para>
				<Bullets>
					<li>
						We read your Google Health data only after you grant permission on
						Google's consent screen, and only the categories you leave ticked.
					</li>
					<li>
						We store a copy of that data on servers we control, so that the app
						can answer your questions about your own history without calling
						Google every time.
					</li>
					<li>
						We do not sell your data, we do not use it for advertising, and we
						do not hand it to anyone else to use for their own purposes.
					</li>
					<li>
						Your health data leaves our servers only when you connect a Model
						Context Protocol (MCP) client yourself. You choose that client, and
						the data goes where you point it.
					</li>
					<li>
						You can revoke our access at Google, delete the copies we hold, or
						delete your account entirely, at any time, without giving a reason.
					</li>
					<li>
						We do not use your health data to train machine learning models.
					</li>
					<li>
						If you subscribe to a paid plan, {LEGAL.paymentProcessor} handles
						the card details — they never reach our servers — and your health
						data is no part of the payment.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "who-we-are",
		title: "Who we are and what this policy covers",
		body: (
			<>
				<Para>
					{LEGAL.appName} ("the Service", "we", "us") is operated by{" "}
					{LEGAL.operator}, {LEGAL.operatorDescription} based in{" "}
					{LEGAL.operatorLocation}. For anything in this policy, write to{" "}
					<ContactEmail />.
				</Para>
				<Para>
					This policy covers the {LEGAL.appName} website at {LEGAL.siteUrl}, the
					accounts it issues, and the MCP endpoint it exposes to you.
				</Para>
				<Para>It does not cover:</Para>
				<Bullets>
					<li>
						<strong>Google.</strong> Your Google Account and the health data
						held inside Google Health remain governed by{" "}
						<ExternalLink href={LEGAL_LINKS.googlePrivacyPolicy}>
							Google's Privacy Policy
						</ExternalLink>
						. We are a client of Google's APIs, not a part of Google.
					</li>
					<li>
						<strong>MCP clients you connect.</strong> If you point an AI
						assistant or another tool at your MCP endpoint, that tool — and any
						model provider behind it — handles your data under its own terms.
						See <Ref id="mcp" />.
					</li>
					<li>
						<strong>Devices and apps that write to Google Health.</strong> How
						your watch, phone or fitness app collects data in the first place is
						between you and that vendor.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "information-we-collect",
		title: "Information we collect",
		body: (
			<>
				<Subheading>a. Account information</Subheading>
				<Para>
					When you create an account we store your name, email address, whether
					that address has been verified, and the timestamps of account creation
					and updates. If you sign up with a password, we store a salted hash of
					it and never the password itself. If you sign in with Google, we store
					the Google account identifier and the basic profile fields Google
					returns for the <code className="font-mono">openid</code>,{" "}
					<code className="font-mono">email</code> and{" "}
					<code className="font-mono">profile</code> scopes.
				</Para>

				<Subheading>b. Google Health data</Subheading>
				<Para>
					Signing in with Google grants us nothing beyond your identity. Health
					access is a separate consent, which you give from your dashboard and
					which Google lets you narrow permission by permission. The categories
					we can request are:
				</Para>
				<HealthDataTable />
				<Para>
					"Read" means we can retrieve records from Google Health. "Write" means
					we can add records on your behalf; a write permission does not let us
					read, and it only covers records this app itself wrote. Whatever you
					leave unticked on Google's consent screen, we never receive. Your
					dashboard shows exactly which permissions Google actually granted.
				</Para>

				<Subheading>c. Google authorization credentials</Subheading>
				<Para>
					To keep reading your data after you close the browser, we store the
					OAuth access token and refresh token Google issues, their expiry
					times, and the list of scopes Google says you granted. These tokens
					are encrypted at rest with a key held only on our server. They are
					credentials, not content: we use them to call Google's APIs as you,
					and for nothing else.
				</Para>

				<Subheading>d. Session and technical data</Subheading>
				<Para>
					We set a session cookie so you stay signed in. It is strictly
					necessary for the Service to work — it is not an advertising or
					tracking cookie, and we do not use any. Our servers also record
					ordinary operational logs: IP address, user agent, request path,
					response status, timestamps, and diagnostic detail when something
					fails.
				</Para>

				<Subheading>e. Billing information</Subheading>
				<Para>
					If you subscribe to a paid plan, {LEGAL.paymentProcessor} collects
					your payment details and takes the payment. Your card number is
					entered with them and stored by them; it does not pass through our
					servers and we have no way to see it. What we hold is your plan, your
					billing period and its renewal date, {LEGAL.paymentProcessor}'s
					customer and transaction references, and the invoices we are required
					to keep. If you only ever use the free plan, none of this exists.
				</Para>
				<Para>
					Your health data is never part of a payment. {LEGAL.paymentProcessor}{" "}
					receives what it needs to charge you — an account identifier, an email
					address and an amount — and nothing about what is in your account.
				</Para>

				<Subheading>f. What we do not collect</Subheading>
				<Para>
					We do not use third-party analytics, advertising SDKs, tracking pixels
					or fingerprinting. We do not buy data about you from data brokers, and
					we do not collect precise device location outside the workout GPS
					traces Google Health itself holds and you explicitly authorize.
				</Para>
			</>
		),
	},
	{
		id: "how-we-use",
		title: "How we use your information",
		body: (
			<>
				<Para>
					We use each kind of data only for the purposes listed against it:
				</Para>
				<Bullets>
					<li>
						<strong>Account information</strong> — to authenticate you, keep you
						signed in, tell your data apart from another user's, and reply when
						you contact us.
					</li>
					<li>
						<strong>Google Health data</strong> — to retrieve the records you
						authorized, store your copy, show it back to you, write records you
						ask the app to write, and serve it to an MCP client you have
						connected.
					</li>
					<li>
						<strong>Authorization credentials</strong> — to call Google's APIs
						on your behalf and to refresh access when a token expires.
					</li>
					<li>
						<strong>Session and technical data</strong> — to operate the Service
						securely: diagnosing faults, investigating abuse, enforcing rate
						limits, and meeting legal obligations.
					</li>
					<li>
						<strong>Billing information</strong> — to take the payment you
						authorized, renew or end a subscription when you say so, decide
						which plan's features you get, issue invoices and refunds, and meet
						tax and accounting obligations.
					</li>
				</Bullets>
				<Callout tone="warning">
					We do not use your health data to train or fine-tune machine learning
					models. We do not use it to build advertising profiles or to target
					advertising. We do not use it to make or support decisions about your
					credit, insurance, employment, or eligibility for anything. We do not
					use it for any purpose you have not asked for.
				</Callout>
			</>
		),
	},
	{
		id: "legal-basis",
		title: "Consent and legal basis",
		body: (
			<>
				<Para>
					Health information is sensitive personal information under the
					personal information laws of {LEGAL.operatorLocation} and under
					comparable laws elsewhere. We process it on the basis of your
					separate, specific and informed consent, given on Google's consent
					screen and recorded as the scopes Google returns to us. We process
					account and technical data on the basis of performing the agreement
					between us and of our legitimate interest in keeping the Service
					secure.
				</Para>
				<Para>
					You can withdraw consent at any time, in whole or for individual
					categories, using the methods in <Ref id="your-choices" />. Withdrawal
					stops future processing; it does not make processing that already
					happened unlawful.
				</Para>
			</>
		),
	},
	{
		id: "google-limited-use",
		title: "Google API Services User Data Policy and Limited Use",
		body: (
			<>
				<Callout>
					<Para>
						{LEGAL.appName}'s use and transfer of information received from
						Google APIs to any other app will adhere to the{" "}
						<ExternalLink href={LEGAL_LINKS.googleUserDataPolicy}>
							Google API Services User Data Policy
						</ExternalLink>
						, including the{" "}
						<ExternalLink href={LEGAL_LINKS.googleLimitedUse}>
							Limited Use requirements
						</ExternalLink>
						.
					</Para>
				</Callout>
				<Para>In practice, that commitment means all of the following.</Para>
				<Bullets>
					<li>
						We limit our use of data obtained through Google APIs to providing
						or improving the user-facing features that are prominent in the
						Service's interface, and which you have authorized.
					</li>
					<li>
						We do not transfer that data to others except: as necessary to
						provide or improve those features, with your explicit consent; for
						security purposes such as investigating abuse; or to comply with
						applicable law.
					</li>
					<li>
						We do not use, and do not allow others to use, that data for serving
						advertisements of any kind, including personalized, retargeted or
						interest-based advertising.
					</li>
					<li>
						We do not sell that data, and we do not transfer it to data brokers,
						information resellers, credit bureaus, or any party that would use
						it for their own purposes.
					</li>
					<li>
						We do not allow humans to read that data, unless: you gave explicit
						consent for specific data, for example so we can investigate a
						problem you reported; it is necessary for security purposes such as
						investigating abuse; it is required by applicable law; or the data
						has been aggregated and de-identified and is used for internal
						operations.
					</li>
					<li>
						We do not use health data to determine credit-worthiness, insurance
						eligibility, employment suitability, or for any similar decision
						about you.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "mcp",
		title: "MCP access, and what it means for your data",
		body: (
			<>
				<Para>
					The Service can expose your own data over the{" "}
					<ExternalLink href={LEGAL_LINKS.modelContextProtocol}>
						Model Context Protocol
					</ExternalLink>{" "}
					(MCP), an open standard that lets a tool you run — typically an AI
					assistant — read data from a server you point it at. The purpose is to
					let you use your health data with tools of your own choosing rather
					than only the ones we build.
				</Para>
				<Bullets>
					<li>
						<strong>It is off until you turn it on.</strong> No MCP endpoint is
						active for your account until you enable it and issue credentials.
					</li>
					<li>
						<strong>It is scoped to you.</strong> Credentials you issue reach
						only your own account's data. They never reach another user's.
					</li>
					<li>
						<strong>You choose the destination.</strong> When you connect a
						client, your health data is transmitted to that client at your
						direction. If that client sends it onward to a model provider — a
						hosted AI service, for example — that provider receives your health
						data and handles it under its own privacy policy and terms.
					</li>
					<li>
						<strong>We never initiate that transfer.</strong> We do not send
						your data to any AI provider, or to any other third party, on our
						own initiative. Every such transfer is one you started by connecting
						a client.
					</li>
					<li>
						<strong>You can revoke it.</strong> Revoking MCP credentials stops
						all future access immediately. It cannot recall data that a client
						has already received — no one can, which is why the choice of client
						matters.
					</li>
				</Bullets>
				<Callout tone="warning">
					Before you connect a client, read its privacy policy. A client running
					entirely on your own machine keeps your health data local; a client
					backed by a hosted model sends it to that vendor. We have no control
					over, and accept no responsibility for, what a client you chose does
					with data you directed to it.
				</Callout>
			</>
		),
	},
	{
		id: "sharing",
		title: "How we share information",
		body: (
			<>
				<Para>
					<strong>We do not sell your personal information</strong>, and we have
					never done so. We do not share it with third parties for their own
					marketing, advertising or analytics. The complete list of cases where
					your information leaves our systems is:
				</Para>
				<Bullets>
					<li>
						<strong>Google</strong> — as the source of the health data you
						authorized us to read, and the destination for records you ask us to
						write back.
					</li>
					<li>
						<strong>MCP clients you connect</strong> — at your direction only,
						as described in <Ref id="mcp" />.
					</li>
					<li>
						<strong>Infrastructure providers</strong> — the hosting and database
						providers that run our servers. They process data only to provide
						that infrastructure to us, under contract, and are not permitted to
						use it for their own purposes.
					</li>
					<li>
						<strong>{LEGAL.paymentProcessor}</strong>, our payment processor —
						only if you subscribe, and only what is needed to charge you: an
						account identifier, an email address and an amount. It never
						receives your health data. It acts on our instructions, and it is
						where your card details live: they are entered with{" "}
						{LEGAL.paymentProcessor} and stored by {LEGAL.paymentProcessor},
						never on our servers.
					</li>
					<li>
						<strong>Legal compulsion</strong> — where we are required to
						disclose by valid legal process. We will tell you before we comply
						unless we are legally prohibited from doing so, and we will object
						to requests that are overbroad.
					</li>
					<li>
						<strong>Change of operator</strong> — if the Service is ever
						transferred to another operator, we will give you notice in advance,
						so that you can export or delete your data before the transfer takes
						effect.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "retention",
		title: "How long we keep it",
		body: (
			<Bullets>
				<li>
					<strong>Google Health data</strong> — kept until you delete it or
					delete your account. There is no automatic expiry, because the point
					of storing it is to give you your own history.
				</li>
				<li>
					<strong>Authorization credentials</strong> — deleted as soon as you
					disconnect Google Health in the app. If you revoke at Google instead,
					the stored tokens stop working immediately and are removed the next
					time we try to use them.
				</li>
				<li>
					<strong>Account information</strong> — kept until you delete your
					account.
				</li>
				<li>
					<strong>Server logs</strong> — kept for{" "}
					{LEGAL_RETENTION.serverLogDays} days, then discarded.
				</li>
				<li>
					<strong>Billing records</strong> — invoices and transaction records
					are kept for as long as tax and accounting law requires us to keep
					them, which is years rather than days. This is the one thing deleting
					your account does not remove: we are not allowed to destroy a record
					of a payment we took. It contains what you paid and when, not what is
					in your health data.
				</li>
				<li>
					<strong>Backups</strong> — encrypted backups roll off within{" "}
					{LEGAL_RETENTION.backupPurgeDays} days, so data you deleted can
					persist in a backup for up to that long before it is gone for good. We
					do not restore deleted data from backups.
				</li>
			</Bullets>
		),
	},
	{
		id: "your-choices",
		title: "Revoking access and deleting your data",
		body: (
			<>
				<Para>
					These three controls are independent, and you can use any of them at
					any time without giving a reason.
				</Para>
				<Steps>
					<li>
						<strong>Revoke our access at Google.</strong> Go to{" "}
						<ExternalLink href={LEGAL_LINKS.googlePermissions}>
							{LEGAL_LINKS.googlePermissions}
						</ExternalLink>{" "}
						and remove {LEGAL.appName}. We can no longer read anything from
						Google Health from that moment. Copies we already stored are not
						affected — use step 2 or 3 for those.
					</li>
					<li>
						<strong>Disconnect inside the app.</strong> Your dashboard's Google
						Health card lets you change or withdraw individual permissions.
						Disconnecting deletes the stored access and refresh tokens.
					</li>
					<li>
						<strong>Delete your stored data, or your whole account.</strong>{" "}
						Email <ContactEmail /> from the address on the account and say
						whether you want the health data deleted or the entire account
						removed. We complete it within {LEGAL_RETENTION.deletionRequestDays}{" "}
						days and confirm when it is done. Deletion is permanent; see the
						backup window — and the billing records we are not allowed to
						destroy — in <Ref id="retention" />.
					</li>
				</Steps>
				<Para>
					Cancelling a paid subscription is a fourth, separate thing, and it
					deletes nothing: your account and your data carry on, on the free
					plan. How to cancel is in the{" "}
					<Link
						className="text-primary underline underline-offset-2"
						to="/terms"
					>
						Terms of Service
					</Link>
					.
				</Para>
				<Para>
					Deleting your account with us does not delete anything inside Google
					Health. Your data there stays yours, and you can export it with{" "}
					<ExternalLink href={LEGAL_LINKS.googleTakeout}>
						Google Takeout
					</ExternalLink>
					.
				</Para>
			</>
		),
	},
	{
		id: "rights",
		title: "Your rights",
		body: (
			<>
				<Para>
					Depending on where you live, you may have some or all of the following
					rights. We honour them for every user regardless of location, because
					drawing the line by geography would be arbitrary:
				</Para>
				<Bullets>
					<li>to know what personal information we hold about you, and why;</li>
					<li>
						to obtain a copy of it in a portable, machine-readable format;
					</li>
					<li>to correct information that is inaccurate or incomplete;</li>
					<li>to have it deleted;</li>
					<li>to restrict or object to particular processing;</li>
					<li>to withdraw consent, in whole or for individual categories;</li>
					<li>
						to be free from discrimination for exercising any of these rights.
						We do not deny service, charge different prices, or degrade quality
						because you exercised a right.
					</li>
				</Bullets>
				<Para>
					To exercise any of them, email <ContactEmail /> from the address on
					your account — that is how we verify a request, and we will ask for
					more proof only if we have genuine reason to doubt it. We respond
					within {LEGAL_RETENTION.deletionRequestDays} days. You also have the
					right to complain to your local data protection authority.
				</Para>
			</>
		),
	},
	{
		id: "security",
		title: "How we protect it",
		body: (
			<>
				<Bullets>
					<li>
						All traffic to the Service is encrypted in transit with HTTPS/TLS.
					</li>
					<li>
						Google access and refresh tokens are encrypted at rest with a
						server-side key. Rotating that key makes every stored token
						unreadable, which forces re-consent rather than leaving a usable
						credential behind.
					</li>
					<li>Passwords, where used, are stored only as salted hashes.</li>
					<li>
						Session cookies are HTTP-only and same-site, so page scripts cannot
						read them and other sites cannot replay them.
					</li>
					<li>
						Access to production systems is limited to the operator, on the
						principle of least privilege, and health data is not read by a human
						except in the narrow cases listed in <Ref id="google-limited-use" />
						.
					</li>
				</Bullets>
				<Para>
					No system is perfectly secure, and we will not claim otherwise. If a
					breach affects your data, we will notify you and the relevant
					authorities as required by law, without undue delay.
				</Para>
			</>
		),
	},
	{
		id: "international",
		title: "Where your data is processed",
		body: (
			<Para>
				We operate from {LEGAL.operatorLocation}, and the servers and
				infrastructure providers we use may be located in other countries. Your
				data may therefore be transferred to, stored in and processed in a
				country other than the one you live in, where data protection law may
				differ. Where the law requires a safeguard for such a transfer, we put
				one in place. Using the Service means you understand this.
			</Para>
		),
	},
	{
		id: "children",
		title: "Children",
		body: (
			<Para>
				The Service is not intended for anyone under 18, and we do not knowingly
				collect personal information — least of all health information — from
				anyone under 18. If you believe someone under 18 has given us data,
				email <ContactEmail /> and we will delete the account and its data
				promptly.
			</Para>
		),
	},
	{
		id: "changes",
		title: "Changes to this policy",
		body: (
			<Para>
				We may update this policy. When we do, we change the "Last updated" date
				at the top and publish the new text here. If a change materially reduces
				your privacy — a new category of data, a new recipient, a new purpose —
				we will notify you by email or in the app before it takes effect, and
				where the law requires it we will ask for your consent again. Continuing
				to use the Service after a change takes effect means you accept the
				updated policy; if you do not, you can delete your data and your account
				as described in <Ref id="your-choices" />.
			</Para>
		),
	},
	{
		id: "contact",
		title: "Contact",
		body: (
			<>
				<Para>
					Questions, requests and complaints about privacy all go to the same
					place, and a person reads them:
				</Para>
				<Bullets>
					<li>
						Email: <ContactEmail />
					</li>
					<li>
						Operator: {LEGAL.operator}, {LEGAL.operatorDescription} based in{" "}
						{LEGAL.operatorLocation}
					</li>
					<li>Service: {LEGAL.siteUrl}</li>
				</Bullets>
			</>
		),
	},
];

function PrivacyPolicyPage() {
	return (
		<LegalDocument
			intro={
				<>
					<Para>
						{LEGAL.appName} connects to your Google Health data so that you can
						see, keep and use your own health history — including through AI
						tools you choose to run yourself. Health data is about as personal
						as data gets, so this policy sets out plainly what we collect, why,
						where it goes, and how to make it go away.
					</Para>
					<Para>
						It applies to everyone who uses {LEGAL.appName}, and it is written
						to be read rather than to be survived. If anything here is unclear,
						ask us at <ContactEmail /> and we will explain it — and, if the text
						was the problem, fix it.
					</Para>
				</>
			}
			sections={SECTIONS}
			title="Privacy Policy"
		/>
	);
}
