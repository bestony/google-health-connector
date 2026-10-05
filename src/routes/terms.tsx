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
	Subheading,
} from "../components/legal-document";
import { HISTORY_LIMIT_DAYS } from "../lib/health-history";
import { LEGAL, LEGAL_LINKS, LEGAL_RETENTION } from "../lib/legal";

/**
 * Terms of Service.
 *
 * Public and unguarded for the same reason as `/privacy`: Google's OAuth
 * verification review opens both URLs without an account, and the consent
 * screen links to them.
 *
 * The `not-medical-advice` section is the one clause a health app cannot do
 * without. Keep it prominent and keep it early.
 */

export const Route = createFileRoute("/terms")({
	head: () => ({
		meta: [
			{ title: `Terms of Service — ${LEGAL.appName}` },
			{
				name: "description",
				content: `The agreement between you and ${LEGAL.appName}, covering accounts, Google Health access, MCP access and acceptable use.`,
			},
		],
	}),
	component: TermsOfServicePage,
});

/** Cross-references into `SECTIONS`, numbered from its order rather than by hand. */
const Ref = createSectionRef(() => SECTIONS);

const SECTIONS: readonly LegalSection[] = [
	{
		id: "acceptance",
		title: "Agreement to these terms",
		body: (
			<>
				<Para>
					These Terms of Service ("Terms") are an agreement between you and{" "}
					{LEGAL.operator}, {LEGAL.operatorDescription} based in{" "}
					{LEGAL.operatorLocation}, who operates {LEGAL.appName} ("the Service",
					"we", "us"). By creating an account or using the Service, you accept
					these Terms. If you do not accept them, do not use the Service.
				</Para>
				<Para>
					Our{" "}
					<Link
						className="text-primary underline underline-offset-2"
						to="/privacy"
					>
						Privacy Policy
					</Link>{" "}
					forms part of these Terms and describes what we do with your data.
				</Para>
			</>
		),
	},
	{
		id: "service",
		title: "What the Service does",
		body: (
			<>
				<Para>{LEGAL.appName} lets you:</Para>
				<Bullets>
					<li>
						connect your Google Account and authorize access to Google Health;
					</li>
					<li>
						read the health data categories you authorized, live from Google,
						reaching back up to {HISTORY_LIMIT_DAYS} days, without storing a
						server-side copy;
					</li>
					<li>
						write records back to Google Health, for the categories where you
						granted write permission;
					</li>
					<li>
						optionally expose your own data to a Model Context Protocol (MCP)
						application that you choose and approve.
					</li>
				</Bullets>
				<Para>
					The Service is a tool for working with data you already own. It is not
					a health record system of record, and it is not a substitute for the
					apps and devices that produce your data.
				</Para>
			</>
		),
	},
	{
		id: "eligibility",
		title: "Eligibility and your account",
		body: (
			<Bullets>
				<li>
					You must be at least 18 years old and able to enter into a binding
					agreement.
				</li>
				<li>
					You must give accurate account information and keep it up to date.
				</li>
				<li>
					You are responsible for your credentials and for everything done
					through your account. Tell us at <ContactEmail /> as soon as you
					suspect unauthorized access.
				</li>
				<li>
					One account per person. Do not share an account, and do not let anyone
					else use yours.
				</li>
			</Bullets>
		),
	},
	{
		id: "google-access",
		title: "Google Account and health permissions",
		body: (
			<>
				<Bullets>
					<li>
						The Service needs a Google Account. Your use of that account is
						governed by your agreement with Google, not by us.
					</li>
					<li>
						Health access is a separate consent from signing in. You grant it on
						Google's consent screen, permission by permission, and you can leave
						any of them unticked.
					</li>
					<li>
						Authorization is incremental: a later request adds permissions
						without revoking earlier ones. Your dashboard always shows what
						Google actually granted, which may be less than what was asked for.
					</li>
					<li>
						You can revoke everything at{" "}
						<ExternalLink href={LEGAL_LINKS.googlePermissions}>
							{LEGAL_LINKS.googlePermissions}
						</ExternalLink>{" "}
						at any time. Features that depend on the revoked permission will
						stop working, which is expected and is not a fault in the Service.
					</li>
					<li>
						Google may change, restrict or withdraw its APIs. If that breaks a
						feature, we may have to change or remove it.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "not-medical-advice",
		title: "Not medical advice",
		body: (
			<>
				<Callout tone="warning">
					<Para>
						<strong>
							{LEGAL.appName} is not a medical device and does not provide
							medical advice, diagnosis or treatment.
						</strong>{" "}
						Nothing it shows you is reviewed by a clinician. Never disregard
						professional medical advice, and never delay seeking it, because of
						something you read here. If you think you may have a medical
						emergency, call your doctor or your local emergency number
						immediately.
					</Para>
				</Callout>
				<Para>
					The data the Service shows comes from consumer devices and apps by way
					of Google Health. It can be incomplete, delayed, duplicated or simply
					wrong — because a sensor was inaccurate, a device did not sync, a
					permission was withdrawn, or an API call failed. Any summary, trend or
					answer the Service produces from that data inherits those limits.
				</Para>
				<Para>
					Do not use the Service to make decisions about medication, treatment,
					or whether to seek care. You use it, and anything derived from it, at
					your own risk.
				</Para>
			</>
		),
	},
	{
		id: "your-data",
		title: "Your data stays yours",
		body: (
			<>
				<Para>
					You own your health data. Nothing here transfers ownership of it to
					us.
				</Para>
				<Para>
					You grant us a limited, non-exclusive, revocable, royalty-free licence
					to process and transmit your data solely to operate the features you
					asked for — retrieving it live from Google, returning it to you,
					writing back what you asked to write, and serving it to an MCP client
					you connected. The licence exists only to make the Service work, and
					it ends when you withdraw the applicable permission or delete your
					account.
				</Para>
				<Para>
					We do not use your health data to train or fine-tune machine learning
					models, we do not sell it, and we do not use it for advertising. The{" "}
					<Link
						className="text-primary underline underline-offset-2"
						to="/privacy"
					>
						Privacy Policy
					</Link>{" "}
					states the full set of limits, including the Google API Services User
					Data Policy commitments we are bound by.
				</Para>
			</>
		),
	},
	{
		id: "mcp",
		title: "MCP access",
		body: (
			<>
				<Para>
					MCP access is an optional feature. It requires either an API key you
					generate or an OAuth application you approve. An API key can access
					your account's MCP data. An OAuth application can access only your
					account and the scopes in its approval.
				</Para>
				<Bullets>
					<li>
						<strong>You choose the application.</strong> You are responsible for
						the applications you approve, and approving an application is your
						instruction to disclose your health data to it within the displayed
						scopes until you revoke that approval. When you connect one, your
						health data is sent to it at your direction. If it forwards your
						data to a model provider or anywhere else, that is a consequence of
						the client you chose, and its terms govern what happens next.
					</li>
					<li>
						<strong>You are responsible for your API keys.</strong> Treat an API
						key like a password. Anyone holding it can read your MCP health
						data. Do not commit it to a repository, paste it into a shared
						document, or give it to anyone you would not hand your health
						records to.
					</li>
					<li>
						<strong>Transfers cannot be undone.</strong> Revoking an API key
						stops future access for that key. Revoking an application's approval
						deletes the approval and its stored access and refresh tokens; the
						MCP endpoint rejects its old access token on the next request. These
						controls are independent and do not revoke each other. Data a client
						already received is beyond our reach.
					</li>
					<li>
						<strong>We may protect the endpoint.</strong> We can rate-limit,
						suspend or revoke MCP credentials that appear compromised, abusive,
						or that threaten the Service's stability. Where practical we tell
						you first.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "acceptable-use",
		title: "Acceptable use",
		body: (
			<>
				<Para>You agree not to:</Para>
				<Bullets>
					<li>
						access or attempt to access any account or data that is not yours;
					</li>
					<li>
						circumvent authentication, authorization, rate limits or any other
						protective measure;
					</li>
					<li>
						probe, scan or test the Service's security, or interfere with its
						operation, without our written permission;
					</li>
					<li>
						scrape, bulk-export or otherwise extract data beyond your own, or
						use the Service to assemble a dataset about anyone else;
					</li>
					<li>resell, sublicense or commercially redistribute the Service;</li>
					<li>
						reverse-engineer or decompile the Service, except where the law
						expressly permits it;
					</li>
					<li>
						use the Service in a way that breaks Google's terms or the Google
						API Services User Data Policy;
					</li>
					<li>
						use health data obtained through the Service to make decisions about
						anyone's credit, insurance, employment or eligibility for anything;
					</li>
					<li>
						use the Service for anything unlawful, or to infringe anyone's
						rights.
					</li>
				</Bullets>
			</>
		),
	},
	{
		id: "availability",
		title: "Availability and changes to the Service",
		body: (
			<Para>
				The Service is provided on an ongoing but not guaranteed basis. We may
				add, change, suspend or discontinue features at any time, and there is
				no uptime commitment or service level agreement. If we decide to shut
				the Service down permanently, we will give you reasonable advance notice
				and a window in which to export or delete your stored account data.
			</Para>
		),
	},
	{
		id: "price",
		title: "Price",
		body: (
			<Para>
				The Service is free to use. We do not charge you, and we do not ask for
				or hold payment details.
			</Para>
		),
	},
	{
		id: "third-party",
		title: "Third-party services",
		body: (
			<Para>
				The Service depends on third parties — Google above all, plus hosting
				and infrastructure providers, and any MCP client you connect. We do not
				control them, we do not endorse them, and we are not responsible for
				their acts, omissions, availability, or terms. Your relationship with
				each of them is your own.
			</Para>
		),
	},
	{
		id: "termination",
		title: "Termination",
		body: (
			<>
				<Para>
					You may stop using the Service at any time, revoke our Google access,
					and ask us to delete your account — we complete deletion requests
					within {LEGAL_RETENTION.deletionRequestDays} days.
				</Para>
				<Para>
					We may suspend or terminate your account if you materially breach
					these Terms, if we are legally required to, or if your use poses a
					security or stability risk to the Service or to other users. Except
					where that is impossible or would defeat the purpose, we will tell you
					why and give you a chance to export your data first.
				</Para>
				<Para>
					<Ref id="not-medical-advice" />, and <Ref id="disclaimers" /> through{" "}
					<Ref id="governing-law" />, survive termination, along with any
					provision that by its nature should.
				</Para>
			</>
		),
	},
	{
		id: "disclaimers",
		title: "Disclaimers",
		body: (
			<Para>
				To the maximum extent permitted by law, the Service is provided "as is"
				and "as available", without warranties of any kind, whether express,
				implied or statutory, including any implied warranty of merchantability,
				fitness for a particular purpose, or non-infringement. We do not warrant
				that the Service will be uninterrupted, timely, secure or error-free,
				nor that the health data it retrieves or derives is accurate, complete
				or current.
			</Para>
		),
	},
	{
		id: "liability",
		title: "Limitation of liability",
		body: (
			<>
				<Para>
					To the maximum extent permitted by law, we are not liable for
					indirect, incidental, special, consequential, exemplary or punitive
					damages, nor for lost profits, lost data, lost goodwill, or the cost
					of substitute services, arising out of or related to the Service —
					whether the claim is framed in contract, tort or otherwise, and even
					if we were told such damages were possible.
				</Para>
				<Para>
					Our total aggregate liability arising out of or related to the Service
					is limited to the greater of the amounts you paid us in the twelve
					months before the event giving rise to the claim, or USD 100.
				</Para>
				<Para>
					Some jurisdictions do not allow certain exclusions or limitations.
					Where that is the case, these limits apply only to the extent
					permitted, and nothing here excludes liability for death or personal
					injury caused by negligence, for fraud, or for anything else that
					cannot lawfully be excluded.
				</Para>
			</>
		),
	},
	{
		id: "indemnity",
		title: "Indemnity",
		body: (
			<Para>
				You agree to indemnify and hold us harmless from claims, damages,
				liabilities and reasonable costs arising from your use of the Service in
				breach of these Terms, your violation of law, or your infringement of
				anyone's rights — including anything that results from an MCP client or
				credential you chose to connect or share.
			</Para>
		),
	},
	{
		id: "governing-law",
		title: "Governing law and disputes",
		body: (
			<>
				<Para>
					These Terms are governed by the laws of {LEGAL.operatorLocation},
					without regard to its conflict-of-laws rules.
				</Para>
				<Subheading>Resolve it informally first</Subheading>
				<Para>
					If something goes wrong, email <ContactEmail /> and describe the
					problem. Most disputes are a misunderstanding, and we would rather fix
					it than litigate it. If we have not resolved it within 30 days of your
					email, either of us may take it further.
				</Para>
				<Subheading>Then, the courts</Subheading>
				<Para>
					Any dispute that cannot be settled informally shall be submitted to
					the courts with jurisdiction at the operator's place of residence. If
					you are a consumer, this does not deprive you of the protection of
					mandatory rules — including the right to bring proceedings — that the
					law of your own country of residence gives you.
				</Para>
			</>
		),
	},
	{
		id: "changes",
		title: "Changes to these terms",
		body: (
			<Para>
				We may update these Terms. The "Last updated" date at the top always
				reflects the current version. For material changes we will give you
				notice by email or in the app before they take effect. Continuing to use
				the Service afterwards means you accept the updated Terms; if you do not
				accept them, stop using the Service and ask us to delete your account.
			</Para>
		),
	},
	{
		id: "misc",
		title: "General",
		body: (
			<Bullets>
				<li>
					<strong>Entire agreement.</strong> These Terms and the Privacy Policy
					are the whole agreement between us about the Service, and supersede
					anything said before.
				</li>
				<li>
					<strong>Severability.</strong> If a provision is unenforceable, it is
					limited or removed to the minimum extent necessary and the rest stays
					in force.
				</li>
				<li>
					<strong>No waiver.</strong> Not enforcing a provision once is not a
					waiver of it.
				</li>
				<li>
					<strong>Assignment.</strong> You may not assign these Terms. We may
					assign them to a successor operator of the Service, on the notice
					described in the Privacy Policy.
				</li>
				<li>
					<strong>Notices.</strong> We reach you at the email address on your
					account; you reach us at <ContactEmail />.
				</li>
				<li>
					<strong>Language.</strong> These Terms are written in English. If we
					publish a translation and the two conflict, the English version
					controls.
				</li>
			</Bullets>
		),
	},
	{
		id: "contact",
		title: "Contact",
		body: (
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
		),
	},
];

function TermsOfServicePage() {
	return (
		<LegalDocument
			intro={
				<>
					<Para>
						These terms set out what you can expect from {LEGAL.appName} and
						what we expect from you. They are deliberately short on ceremony:
						the Service reads health data you already own live from Google and
						hands it to tools you choose. It keeps no copy of it.
					</Para>
					<Para>
						Two sections matter more than the rest. Read{" "}
						<Ref id="not-medical-advice" /> before you act on anything the
						Service shows you, and <Ref id="mcp" /> before you connect an MCP
						client — that feature sends your health data from our servers to a
						third party you choose.
					</Para>
				</>
			}
			sections={SECTIONS}
			title="Terms of Service"
		/>
	);
}
