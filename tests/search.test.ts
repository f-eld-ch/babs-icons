import { describe, expect, it } from "vitest";
import {
  BABS_ICONS,
  BABS_KEYWORDS,
  createIconSearch,
  getIconUsage,
  isPointCategory,
  isPointIcon,
  resolveIconId,
  foldSearchText as fold,
  searchIcons,
} from "../packages/core/src/index.ts";

const de = createIconSearch({ lang: "de" });
const ids = (query: string, search = de) => search(query).map((hit) => hit.id);
describe("fold", () => {
  it("treats an umlaut and its transliteration alike", () => {
    expect(fold("Gebäude").text).toBe(fold("Gebaeude").text);
    expect(fold("Überschwemmung").text).toBe(fold("Ueberschwemmung").text);
    expect(fold("Sanität").text).toBe(fold("Sanitaet").text);
    expect(fold("Straße").text).toBe(fold("Strasse").text);
  });

  it("ignores case, accents and punctuation", () => {
    expect(fold("Étage-Détail").text).toBe("etage detail");
    expect(fold("  Brand,  einzelnes - Gebäude ").text).toBe("brand einzelnes gebaude");
  });

  it("keeps track of where each folded letter came from", () => {
    const folded = fold("Sanitaetshilfsstelle");
    // "ae" is one letter, spanning both original characters
    expect(folded.text.slice(0, 7)).toBe("sanitat");
    expect(folded.from[5]).toBe(5);
    expect(folded.to[5]).toBe(7);
  });
});

describe("search", () => {
  it("finds nothing for an empty or blank query", () => {
    expect(de("")).toEqual([]);
    expect(de("   ")).toEqual([]);
    expect(de("-- ,")).toEqual([]);
  });

  it("puts the exact name first", () => {
    expect(ids("brand")[0]).toBe("8201");
    expect(ids("ambulanz")[0]).toBe("7114");
    expect(ids("sammelstelle")).toContain("5103");
  });

  it("finds a partner's formation by group and rank together", () => {
    // The names only carry the partner as a letter: "Zug-P".
    const result = ids("polizei zug");
    expect(result[0]).toBe("4103");
    expect(result).toContain("4108"); // Offizier-Zugführer-P
    expect(result).not.toContain("4101"); // Trupp-P
    expect(result).not.toContain("4203"); // Zug-FW
  });

  it("does not care about the order of the words or hyphens", () => {
    expect(ids("zug polizei")).toEqual(ids("polizei zug"));
    expect(ids("polizei-trupp")).toEqual(ids("polizei trupp"));
    expect(ids("polizei trupp")[0]).toBe("4101");
  });

  it("finds a name written with umlauts or without", () => {
    expect(ids("sanität")).toEqual(ids("sanitaet"));
    expect(ids("sanität")).toContain("5106"); // Sanitaetshilfsstelle
    expect(ids("gebäude")).toEqual(ids("gebaeude"));
    expect(ids("gebäude")).toContain("8219"); // Gebaeudeeinsturz
    expect(ids("überschwemmung")).toContain("8103");
  });

  it("matches while the word is still being typed", () => {
    expect(ids("sanitae")).toContain("5106");
    expect(ids("sanit")).toContain("5106");
    expect(ids("helik")).toEqual(expect.arrayContaining(["7113", "5129"]));
  });

  it("finds a symbol by a word that is not in its name", () => {
    expect(ids("kaputt").slice(0, 3).sort()).toEqual(["1101", "1102", "1103"]);
    expect(ids("feuer")).toEqual(expect.arrayContaining(["8201", "1104"]));
    expect(ids("heli")).toEqual(expect.arrayContaining(["7113", "5129"]));
    expect(ids("lkw")).toContain("7105");
    expect(ids("sanka")).toContain("7114");
    expect(ids("töff")).toContain("7101");
    expect(ids("toeff")).toContain("7101");
  });

  it("ranks a word in the name before the same word as a keyword or group", () => {
    // "Feuerwehr" is the group of the FW formations; "Brand" carries the keyword "feuer".
    const result = ids("feuer");
    expect(result.indexOf("8201")).toBeLessThan(result.indexOf("4203"));
  });

  it("never matches numbers or the technical alias", () => {
    expect(de("4101")).toEqual([]);
    expect(de("1101")).toEqual([]);
    expect(de("babsBeschaedigung")).toEqual([]);
  });

  it("limits the number of results", () => {
    expect(de("a", 5).length).toBeLessThanOrEqual(5);
    expect(de("e").length).toBeLessThanOrEqual(50);
  });

  it("returns every matching word in all the words of the query or nothing", () => {
    expect(de("polizei brand")).toEqual([]);
  });
});

describe("other languages", () => {
  const fr = createIconSearch({ lang: "fr" });
  const it_ = createIconSearch({ lang: "it" });

  it("searches the names in the language of the interface", () => {
    expect(ids("incendie", fr).length).toBeGreaterThan(0);
    expect(ids("incendio", it_).length).toBeGreaterThan(0);
    expect(fr("incendie")[0].label.toLowerCase()).toContain("incendie");
  });

  it("also finds a symbol by its German name", () => {
    expect(ids("brand", fr)).toContain("8201");
    expect(ids("zug polizei", fr)).toContain("4103");
  });

  it("falls back to German for a language the catalogue does not have", () => {
    expect(ids("brand", createIconSearch({ lang: "en" }))[0]).toBe("8201");
    expect(createIconSearch({ lang: "en" })).toBe(createIconSearch({ lang: "de" }));
  });
});

describe("what is shown", () => {
  it("names the place of a symbol, without repeating a group that says it all", () => {
    const zug = de("polizei zug")[0];
    expect(zug.label).toBe("Zug-P");
    expect(zug.path).toBe("Formationen › Polizei");

    // category and group are both "Fahrzeuge"
    expect(de("ambulanz")[0].path).toBe("Fahrzeuge");
    // the group name starts with the category's
    expect(de("beschaedigung")[0].path).toMatch(/^Auswirkungen von Schadenereignissen/);
  });

  it("marks where the query matched in the name and in the path", () => {
    const zug = de("polizei zug")[0];
    expect(zug.labelMatch.map(([a, b]) => zug.label.slice(a, b))).toEqual(["Zug"]);
    expect(zug.pathMatch.map(([a, b]) => zug.path.slice(a, b))).toEqual(["Polizei"]);

    // The two characters "ae" are one letter of the query, and are marked as one stretch.
    const typed = de("sanität").find((hit) => hit.id === "5106")!;
    expect(typed.labelMatch.map(([a, b]) => typed.label.slice(a, b))).toEqual(["Sanitaet"]);

    const partial = de("sanitae").find((hit) => hit.id === "5106")!;
    expect(partial.labelMatch.map(([a, b]) => partial.label.slice(a, b))).toEqual(["Sanitae"]);
  });

  it("marks nothing for a match through a keyword", () => {
    const hit = de("kaputt").find((h) => h.id === "1101")!;
    expect(hit.labelMatch).toEqual([]);
    expect(hit.pathMatch).toEqual([]);
  });
});

describe("keywords", () => {
  it("exist in every language for every symbol that has any", () => {
    const incomplete = Object.entries(BABS_KEYWORDS)
      .filter(([, words]) => !words.de?.length || !words.fr?.length || !words.it?.length)
      .map(([id]) => id);
    expect(incomplete).toEqual([]);
  });

  it("find a symbol by a word of the interface language", () => {
    const fr = createIconSearch({ lang: "fr" });
    const it_ = createIconSearch({ lang: "it" });
    expect(fr("coulée de boue").map((h) => h.id)).toContain("8104");
    expect(it_("colata di fango").map((h) => h.id)).toContain("8104");
    expect(fr("panne de courant").map((h) => h.id)).toContain("8207");
    expect(it_("mancanza di corrente").map((h) => h.id)).toContain("8207");
  });

  it("name only symbols the catalogue has", () => {
    expect(Object.keys(BABS_KEYWORDS).filter((id) => !(id in BABS_ICONS))).toEqual([]);
  });

  it("finds a symbol by a keyword in any language of the interface", () => {
    expect(ids("murgang")).toContain("8104");
    expect(createIconSearch({ lang: "fr" })("murgang").map((h) => h.id)).toContain("8104");
  });
});

describe("options", () => {
  it("leaves out what the filter rejects", () => {
    const only = createIconSearch({ lang: "de", filter: (meta) => meta.category === "8" });
    expect(only("brand")[0].id).toBe("8201");
    expect(only("polizei zug")).toEqual([]);
  });

  it("searches once without building an index by hand", () => {
    expect(searchIcons("brand", { lang: "de", limit: 3 }).length).toBeLessThanOrEqual(3);
  });
});

describe("usage and identifiers", () => {
  it("tells point symbols from line, zone and illustration ones", () => {
    expect(getIconUsage("4103")).toBe("point");
    expect(getIconUsage("1113")).toBe("line");
    expect(getIconUsage("1114")).toBe("zone");
    expect(getIconUsage("1106b")).toBe("illustration");
    // every Bewegungen symbol is a line symbol, listed or not
    expect(getIconUsage("6102a")).toBe("line");
  });

  it("knows which categories have anything to place", () => {
    expect(isPointCategory("4")).toBe(true);
    expect(isPointCategory("6")).toBe(false);
    expect(isPointIcon("1203")).toBe(false);
  });

  it("resolves id, alias and export name to the id", () => {
    expect(resolveIconId("1101")).toBe("1101");
    expect(resolveIconId("babsBeschaedigung")).toBe("1101");
    expect(resolveIconId("babs1101")).toBe("1101");
    expect(resolveIconId("Beschaedigung")).toBeUndefined();
    expect(resolveIconId(undefined)).toBeUndefined();
  });
});
