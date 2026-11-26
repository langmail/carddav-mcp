import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerListContacts } from "./list-contacts.js";

type ToolHandler = (params: {
	addressBookUrl: string;
}) => Promise<{ content: { type: string; text: string }[] }>;

const BOOK = "https://dav.example.org/dav/contacts/";

const member = (href: string) => ({ href, ok: true, props: {}, raw: {} });

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "list-contacts") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

function run(client: unknown, addressBookUrl = BOOK) {
	const { server, getHandler } = makeServer();
	registerListContacts(client as DAVClient, server);
	const handler = getHandler();
	if (!handler) throw new Error("handler not registered");
	return handler({ addressBookUrl });
}

function parse(result: { content: { text: string }[] }) {
	const text = result.content[0]?.text;
	if (!text) throw new Error("no text content");
	return JSON.parse(text);
}

describe("registerListContacts", () => {
	test("returns a summary per contact", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValue([
					member("/dav/contacts/"),
					member("/dav/contacts/a.vcf"),
					member("/dav/contacts/b.vcf"),
				]),
			fetchVCards: vi.fn().mockResolvedValue([
				{
					url: "/dav/contacts/a.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.com\r\nTEL:+44 20 7946 0000\r\nEND:VCARD\r\n",
				},
				{
					url: "/dav/contacts/b.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:b\r\nFN:Grace Hopper\r\nEND:VCARD\r\n",
				},
			]),
		};

		const result = await run(mockClient);

		expect(mockClient.propfind).toHaveBeenCalledWith({
			url: BOOK,
			props: { "d:resourcetype": {}, "d:getcontenttype": {} },
			depth: "1",
		});
		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: BOOK },
			objectUrls: ["/dav/contacts/a.vcf", "/dav/contacts/b.vcf"],
		});
		expect(parse(result)).toEqual([
			{
				uid: "a",
				fn: "Ada Lovelace",
				emails: ["ada@example.com"],
				phones: ["+44 20 7946 0000"],
			},
			{ uid: "b", fn: "Grace Hopper", emails: [], phones: [] },
		]);
	});

	test("skips entries without vCard data", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValue([
					member("/dav/contacts/broken.vcf"),
					member("/dav/contacts/a.vcf"),
				]),
			fetchVCards: vi.fn().mockResolvedValue([
				{ url: "/dav/contacts/broken.vcf", data: undefined },
				{
					url: "/dav/contacts/a.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Ada\r\nEND:VCARD\r\n",
				},
			]),
		};

		expect(parse(await run(mockClient))).toHaveLength(1);
	});

	test.each([
		[
			"a differing trailing slash",
			"https://dav.example.org/dav/contacts",
			"/dav/contacts/",
		],
		[
			"differing percent-encoding",
			"https://dav.example.org/carddav/user@example.org/Contacts/",
			"/carddav/user%40example.org/Contacts/",
		],
	])("recognises the collection's own href with %s", async (_, url, ownHref) => {
		const objectUrl = `${ownHref.replace(/\/$/, "")}/a.vcf`;
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([member(ownHref), member(objectUrl)]),
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		await run(mockClient, url);

		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url },
			objectUrls: [objectUrl],
		});
	});

	test("leaves out failed members and sub-collections", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([
				member("/dav/contacts/"),
				member("/dav/contacts/a.vcf"),
				{ href: "/dav/contacts/gone.vcf", ok: false },
				{
					href: "/dav/contacts/sub/",
					ok: true,
					props: { resourcetype: { collection: {} } },
				},
				{
					href: "/dav/contacts/meta.xml",
					ok: true,
					props: { getcontenttype: "application/xml" },
				},
				{
					href: "/dav/contacts/b.vcf",
					ok: true,
					props: { getcontenttype: "text/x-vcard; charset=utf-8" },
				},
			]),
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		await run(mockClient);

		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: BOOK },
			objectUrls: ["/dav/contacts/a.vcf", "/dav/contacts/b.vcf"],
		});
	});

	test("keeps a member whose href is not valid percent-encoding", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValue([
					member("/dav/contacts/100%.vcf"),
					member("/dav/contacts/"),
				]),
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		await run(mockClient);

		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: BOOK },
			objectUrls: ["/dav/contacts/100%.vcf"],
		});
	});

	test("reports the status of a failed PROPFIND after a redirect", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([
				{
					href: "https://login.example.org/",
					ok: false,
					status: 401,
					statusText: "Unauthorized",
					raw: "",
				},
			]),
			fetchVCards: vi.fn(),
		};

		await expect(run(mockClient)).rejects.toThrow(/401 Unauthorized/);
	});

	test("reports a PROPFIND answer that is not a multistatus", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([
				{
					href: "https://login.example.org/",
					ok: true,
					status: 200,
					statusText: "OK",
					raw: "<html></html>",
				},
			]),
			fetchVCards: vi.fn(),
		};

		await expect(run(mockClient)).rejects.toThrow(
			/200 OK is not a multistatus/,
		);
	});

	test("reports a multiget answer without vCard data", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([member("/dav/contacts/a.vcf")]),
			fetchVCards: vi.fn().mockResolvedValue([{ url: BOOK, data: undefined }]),
		};

		await expect(run(mockClient)).rejects.toThrow(/returned no vCard data/);
		expect(mockClient.fetchVCards).toHaveBeenCalledTimes(1);
	});

	test("keeps the fetch error when listing again fails", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValueOnce([member("/dav/contacts/a.vcf")])
				.mockRejectedValueOnce(new Error("503 Service Unavailable")),
			fetchVCards: vi.fn().mockRejectedValue(new Error("multiget failed: 404")),
		};

		await expect(run(mockClient)).rejects.toThrow("multiget failed: 404");
	});

	test("reports a failed PROPFIND instead of an empty list", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([
				{
					href: BOOK,
					ok: false,
					status: 404,
					statusText: "Not Found",
					raw: "",
				},
			]),
			fetchVCards: vi.fn(),
		};

		await expect(run(mockClient)).rejects.toThrow(/404 Not Found/);
		expect(mockClient.fetchVCards).not.toHaveBeenCalled();
	});

	test("retries once when a card disappears between listing and fetching", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValueOnce([member("/dav/contacts/a.vcf")])
				.mockResolvedValueOnce([member("/dav/contacts/")]),
			fetchVCards: vi
				.fn()
				.mockRejectedValueOnce(new Error("multiget failed: 404"))
				.mockResolvedValueOnce([]),
		};

		expect(parse(await run(mockClient))).toEqual([]);
		expect(mockClient.propfind).toHaveBeenCalledTimes(2);
	});

	test("rethrows the fetch error when no card disappeared", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([member("/dav/contacts/a.vcf")]),
			fetchVCards: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
		};

		await expect(run(mockClient)).rejects.toThrow("401 Unauthorized");
		expect(mockClient.fetchVCards).toHaveBeenCalledTimes(1);
	});

	test("returns an empty list for an empty address book", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([member("/dav/contacts/")]),
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		expect(parse(await run(mockClient))).toEqual([]);
	});
});
