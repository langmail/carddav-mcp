import type { DAVClient, DAVVCard } from "tsdav";

const safeDecode = (path: string) => {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
};

const pathOf = (href: string, base: string) =>
	safeDecode(new URL(href, base).pathname).replace(/\/+$/, "");

const isCard = (props: Record<string, unknown> | undefined) => {
	const contentType = props?.getcontenttype;
	return (
		!("collection" in ((props?.resourcetype ?? {}) as object)) &&
		(contentType === undefined || /vcard/i.test(String(contentType)))
	);
};

/**
 * Discovers card hrefs with PROPFIND instead of tsdav's default
 * addressbook-query, whose condition-less FN prop-filter returns nothing on
 * Open-Xchange (mailbox.org).
 */
async function listCardUrls(
	client: DAVClient,
	addressBookUrl: string,
): Promise<string[]> {
	const responses = await client.propfind({
		url: addressBookUrl,
		props: { "d:resourcetype": {}, "d:getcontenttype": {} },
		depth: "1",
	});
	const self = pathOf(addressBookUrl, addressBookUrl);
	const own = responses.find(
		(r) => r.href && pathOf(r.href, addressBookUrl) === self,
	);
	// tsdav returns failed requests as a single non-ok entry instead of throwing,
	// with the href of the final URL after a redirect.
	if (own?.ok === false || responses.every((r) => !r.props)) {
		const failed = own ?? responses[0];
		const status = `${failed?.status ?? ""} ${failed?.statusText ?? ""}`.trim();
		const reason =
			failed?.ok === false
				? status
				: `${status || "the response"} is not a multistatus`;
		throw new Error(`Listing ${addressBookUrl} failed: ${reason}`);
	}

	return responses.flatMap((r) =>
		r.ok && r.href && r !== own && isCard(r.props) ? [r.href] : [],
	);
}

/** Fetches every card in the address book, retrying once if a card vanishes between listing and fetching. */
export async function fetchCards(
	client: DAVClient,
	addressBookUrl: string,
): Promise<DAVVCard[]> {
	const fetchFrom = async (objectUrls: string[]) => {
		const cards = await client.fetchVCards({
			addressBook: { url: addressBookUrl },
			objectUrls,
		});
		// A 2xx answer that is not a multistatus resolves to entries without data.
		if (cards.length > 0 && cards.every((card) => card.data === undefined)) {
			throw new Error(
				`Fetching cards from ${addressBookUrl} returned no vCard data`,
			);
		}
		return cards;
	};
	const objectUrls = await listCardUrls(client, addressBookUrl);
	try {
		return await fetchFrom(objectUrls);
	} catch (err) {
		const relisted = await listCardUrls(client, addressBookUrl).catch(
			() => undefined,
		);
		if (!relisted || objectUrls.every((url) => relisted.includes(url)))
			throw err;
		return fetchFrom(relisted);
	}
}
