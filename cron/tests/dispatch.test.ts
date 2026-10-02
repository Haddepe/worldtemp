import { describe, expect, it, vi } from "vitest";
import { DISPATCH_URL, dispatch, type Fetch } from "../src/index";

const TOKEN = "github_pat_SECRET123";

function respond(status: number, body = ""): Fetch {
  return vi.fn(async () => new Response(status === 204 ? null : body, { status }));
}

async function failure(env: { GITHUB_TOKEN?: string }, fetchFn: Fetch): Promise<Error> {
  try {
    await dispatch(env, fetchFn, () => {});
  } catch (exc) {
    return exc as Error;
  }
  throw new Error("dispatch aurait dû lever une erreur");
}

describe("dispatch — appel", () => {
  it("envoie POST, les cinq en-têtes, le corps et un délai réseau", async () => {
    const fetchFn = respond(204);
    await dispatch({ GITHUB_TOKEN: TOKEN }, fetchFn, () => {});

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/Haddepe/worldtemp/actions/workflows/pipeline.yml/dispatches");
    expect(url).toBe(DISPATCH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "worldtemp-cron",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe('{"ref":"master"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("token nettoyé : espaces et saut de ligne collés depuis le dashboard", async () => {
    const fetchFn = respond(204);
    await dispatch({ GITHUB_TOKEN: `  ${TOKEN}\n` }, fetchFn, () => {});
    const [, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("dispatch — succès", () => {
  it("200 avec workflow_run_id : renvoie l'id et le journalise", async () => {
    const log = vi.fn();
    const body = JSON.stringify({ workflow_run_id: 37032914266, run_url: "u", html_url: "h" });
    const id = await dispatch({ GITHUB_TOKEN: TOKEN }, respond(200, body), log);
    expect(id).toBe(37032914266);
    expect(log).toHaveBeenCalledWith("déclenché : run 37032914266");
  });

  it("204 sans corps : succès, journal sans id", async () => {
    const log = vi.fn();
    expect(await dispatch({ GITHUB_TOKEN: TOKEN }, respond(204), log)).toBeNull();
    expect(log).toHaveBeenCalledWith("déclenché");
  });

  it.each([
    ["JSON invalide", "pas du json"],
    ["id absent", "{}"],
    ["id en chaîne", '{"workflow_run_id":"42"}'],
    ["corps vide", ""],
  ])("200 sans id exploitable (%s) : succès, journal sans id", async (_cas, body) => {
    const log = vi.fn();
    expect(await dispatch({ GITHUB_TOKEN: TOKEN }, respond(200, body), log)).toBeNull();
    expect(log).toHaveBeenCalledWith("déclenché");
  });
});

describe("dispatch — échecs", () => {
  it.each([401, 403, 404, 422, 500])("HTTP %i : erreur avec le statut, sans le token", async (status) => {
    const err = await failure({ GITHUB_TOKEN: TOKEN }, respond(status, `{"message":"refus ${TOKEN}"}`));
    expect(err.message).toContain(`HTTP ${status}`);
    expect(err.message).toContain("workflow_dispatch refusé");
    expect(err.message).not.toContain(TOKEN);
  });

  it("corps tronqué : une page d'erreur HTML de plusieurs Ko ne garde que 200 caractères", async () => {
    const html = "<html>" + "x".repeat(5000) + "</html>";
    const err = await failure({ GITHUB_TOKEN: TOKEN }, respond(502, html));
    expect(err.message).toBe(`workflow_dispatch refusé : HTTP 502 — ${html.slice(0, 200)}`);
  });

  it("token masqué avant troncature : rien n'en sort même à cheval sur le 200e caractère", async () => {
    const body = "x".repeat(190) + TOKEN + "y".repeat(50);
    const err = await failure({ GITHUB_TOKEN: TOKEN }, respond(500, body));
    expect(err.message).not.toContain(TOKEN.slice(0, 10));
    expect(err.message).toContain("***");
  });

  it("réseau ou délai dépassé : erreur « injoignable »", async () => {
    const fetchFn: Fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const err = await failure({ GITHUB_TOKEN: TOKEN }, fetchFn);
    expect(err.message).toBe("workflow_dispatch injoignable : The operation was aborted due to timeout");
  });

  it("token masqué dans une erreur réseau qui le recopie", async () => {
    const fetchFn: Fetch = vi.fn(async () => {
      throw new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`);
    });
    const err = await failure({ GITHUB_TOKEN: TOKEN }, fetchFn);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("***");
  });

  it.each([
    ["absent", undefined],
    ["vide", ""],
    ["blanc", "  \n"],
  ])("secret %s : erreur avant tout appel", async (_cas, token) => {
    const fetchFn = respond(204);
    const err = await failure({ GITHUB_TOKEN: token }, fetchFn);
    expect(err.message).toBe("GITHUB_TOKEN absent");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
