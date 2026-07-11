import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { convertStrokesForRecognizer } from "./coordinate-adapter";
import { createRecognitionVariants, fuseRecognitionResults } from "./recognition-ensemble";
import type { Stroke } from "./types";

const MEDIANS: Record<string, number[][][]> = {
  "写": [
    [[67,38],[70,46],[70,51],[57,80],[56,92]],
    [[78,47],[82,50],[92,49],[124,43],[175,37],[186,39],[190,42],[193,48],[172,69]],
    [[109,100],[113,97],[131,95],[155,88],[168,88]],
    [[97,66],[103,72],[105,76],[93,138],[107,138],[136,132],[173,128],[184,129],[192,136],[182,190],[177,207],[172,215],[165,220],[138,202]],
    [[42,180],[48,182],[60,182],[80,177],[138,168],[156,172]],
  ],
  "听": [
    [[23,82],[28,87],[32,92],[40,148]],
    [[36,82],[40,84],[69,77],[74,78],[79,84],[73,113],[66,118]],
    [[45,133],[48,129],[64,125],[77,124],[84,126]],
    [[196,42],[178,39],[152,55],[130,65],[128,65],[127,68]],
    [[105,60],[116,70],[116,74],[116,98],[114,123],[109,149],[101,170],[91,187],[76,204],[62,212]],
    [[124,109],[127,107],[151,102],[204,93],[214,93],[226,96]],
    [[160,106],[170,114],[170,241]],
  ],
};

const RAW_MEDIANS: Record<string, number[][][]> = {
  "老": [
    [[319,623],[347,616],[402,618],[532,638],[588,653],[642,648]],
    [[455,842],[504,801],[490,517],[472,493]],
    [[95,418],[152,410],[447,465],[833,513],[880,510],[932,495]],
    [[721,775],[742,745],[751,707],[659,564],[569,452],[438,318],[299,199],[198,129],[128,92]],
    [[771,329],[714,337],[661,301],[602,273],[518,243],[501,242],[479,226]],
    [[428,365],[440,353],[455,318],[448,180],[459,99],[479,69],[513,48],[560,35],[618,31],[707,41],[761,61],[798,91],[793,203]],
  ],
  "师": [
    [[184,626],[202,611],[215,584],[217,449],[205,354],[208,314]],
    [[335,734],[363,714],[380,686],[381,521],[373,412],[361,340],[342,270],[292,167],[251,113],[201,62],[149,26]],
    [[483,672],[532,665],[800,718],[866,714]],
    [[467,495],[491,476],[499,453],[498,353],[485,282],[486,233]],
    [[518,489],[540,477],[786,517],[806,514],[816,506],[829,483],[831,334],[816,276],[811,271],[787,273],[706,295]],
    [[607,648],[651,626],[653,604],[643,-36]],
  ],
  "飞": [
    [[126,574],[175,562],[203,565],[421,625],[531,664],[589,669],[604,654],[571,519],[567,400],[577,311],[590,257],[631,164],[690,97],[736,66],[803,39],[852,31],[902,46],[905,176]],
    [[740,594],[760,573],[768,553],[741,521],[631,420]],
    [[603,388],[609,374],[681,345],[757,303],[791,272],[808,242]],
  ],
  "机": [
    [[89,498],[109,493],[160,497],[368,551],[404,553],[416,548]],
    [[265,800],[317,745],[301,244],[283,69],[283,-17]],
    [[281,495],[273,489],[260,423],[222,353],[162,262],[64,147]],
    [[353,408],[402,372],[419,350]],
    [[480,567],[497,558],[520,530],[521,378],[506,261],[481,189],[447,130],[400,77],[357,48]],
    [[550,556],[561,552],[666,592],[689,588],[700,579],[665,418],[658,312],[661,258],[675,196],[692,158],[714,125],[742,100],[774,81],[831,67],[883,69],[928,87],[935,100],[945,260]],
  ],
  "场": [
    [[135,476],[208,476],[362,520],[410,520]],
    [[252,759],[292,730],[302,716],[293,313],[275,288]],
    [[110,208],[170,198],[432,342]],
    [[432,710],[454,701],[497,699],[658,738],[678,735],[696,720],[636,628],[562,534],[531,485],[525,456],[563,453],[685,478],[846,498],[874,484],[887,465],[870,329],[847,232],[818,147],[782,87],[738,45],[623,104]],
    [[545,423],[563,407],[562,399],[502,300],[402,196],[343,157]],
    [[683,456],[713,428],[691,370],[642,282],[536,144],[458,75],[414,45]],
  ],
  "昕": [
    [[146,689],[171,663],[180,636],[183,490],[167,248],[173,190]],
    [[197,678],[217,671],[297,696],[326,687],[344,671],[344,317],[341,254],[331,220],[336,172]],
    [[209,443],[228,463],[284,461]],
    [[201,219],[219,237],[299,248]],
    [[746,729],[669,734],[545,652],[530,657]],
    [[458,657],[494,630],[504,612],[507,482],[494,342],[473,267],[444,204],[414,159],[378,120],[349,94],[325,82]],
    [[544,481],[555,488],[813,541],[859,541],[905,531]],
    [[667,487],[706,460],[703,-8]],
  ],
  "帅": [
    [[172,641],[188,628],[204,601],[204,309]],
    [[334,766],[377,730],[380,718],[382,515],[373,403],[361,338],[336,256],[283,156],[202,61],[141,17]],
    [[473,538],[492,516],[507,485],[504,284],[512,240]],
    [[520,526],[548,515],[803,563],[824,564],[839,554],[851,541],[852,531],[853,371],[841,309],[831,294],[821,295],[730,330]],
    [[616,780],[641,774],[677,740],[667,502],[667,-34]],
  ],
  "扬": [
    [[135,546],[201,546],[372,598],[425,603]],
    [[300,810],[325,795],[345,764],[329,437],[329,134],[322,103],[304,71],[279,78],[195,118],[176,134],[165,135]],
    [[63,262],[106,257],[386,448]],
    [[443,685],[484,675],[537,683],[665,717],[693,701],[646,614],[559,484],[551,457],[587,451],[823,497],[853,495],[871,486],[888,463],[872,347],[842,228],[812,146],[775,81],[749,49],[722,31],[646,80],[626,87]],
    [[570,423],[590,399],[549,322],[486,244],[423,193]],
    [[687,453],[718,427],[717,420],[694,356],[651,274],[601,196],[559,145],[510,95],[473,64],[462,63],[458,54]],
  ],
  "汤": [
    [[253,763],[340,704],[362,664]],
    [[178,554],[254,495],[269,469]],
    [[219,34],[207,65],[204,114],[233,162],[348,398]],
    [[449,710],[496,698],[658,735],[678,734],[699,716],[647,643],[543,526],[510,481],[499,455],[535,449],[811,498],[836,496],[857,486],[874,466],[857,332],[833,232],[799,129],[768,76],[742,45],[718,29],[614,95]],
    [[529,423],[549,405],[550,394],[523,335],[460,246],[415,202],[390,186]],
    [[677,461],[712,429],[676,332],[638,258],[555,142],[491,76],[462,52],[449,49],[446,41]],
  ],
  "杌": [
    [[105,528],[167,524],[342,568],[397,570]],
    [[253,828],[305,773],[288,220],[275,125],[275,27]],
    [[268,516],[244,426],[204,359],[144,278],[53,183]],
    [[320,431],[377,388],[402,351]],
    [[442,566],[496,558],[770,618],[811,620],[848,614]],
    [[506,486],[516,479],[536,444],[535,428],[492,269],[442,169],[406,121],[374,93]],
    [[635,558],[640,550],[666,538],[680,507],[662,372],[659,260],[665,177],[685,126],[723,107],[786,100],[850,103],[917,122],[928,130],[930,145],[935,285]],
  ],
};

for (const [character, medians] of Object.entries(RAW_MEDIANS)) {
  MEDIANS[character] = medians.map((stroke) => stroke.map(([x, y]) => [x / 4, (900 - y) / 4]));
}

function denseStrokes(character: string): Stroke[] {
  return MEDIANS[character].map((points, strokeIndex) => {
    const dense = points.flatMap((point, index) => {
      const next = points[index + 1];
      if (!next) return [point];
      return Array.from({ length: 16 }, (_, sample) => {
        const progress = sample / 16;
        const jitter = Math.sin((strokeIndex + 1) * (index + 1) * (sample + 1)) * 0.65;
        return [point[0] + (next[0] - point[0]) * progress + jitter, point[1] + (next[1] - point[1]) * progress - jitter];
      });
    });
    return { id: `${character}-${strokeIndex}`, width: 5, points: dense.map(([x, y], index) => ({ x, y, timestamp: index })) };
  });
}

async function loadLookup() {
  const context: Record<string, unknown> = {
    TextDecoder, TextEncoder, URL, Request, fetch, WebAssembly,
  };
  context.self = context;
  vm.runInNewContext(fs.readFileSync(`${process.cwd()}/public/hanzi_lookup.js`, "utf8"), context);
  const module = await WebAssembly.compile(fs.readFileSync(`${process.cwd()}/public/hanzi_lookup_bg.wasm`));
  await (context.wasm_bindgen as (module: WebAssembly.Module) => Promise<unknown>)(module);
  return (input: number[][][], limit: number) => JSON.parse((context.wasm_bindgen as { lookup: (input: number[][][], limit: number) => string }).lookup(input, limit)) as Array<{ hanzi: string }>;
}

function medianStrokes(character: string): Stroke[] {
  let timestamp = 0;
  return MEDIANS[character].map((points, strokeIndex) => {
    timestamp += 200;
    const converted = points.map(([x, y]) => ({ x, y, timestamp: timestamp += 12, pressure: 0.5 }));
    return { id: `${character}-${strokeIndex}`, width: 5, points: converted };
  });
}

function joinStrokes(strokes: Stroke[], groups: number[][], pauseMs: number): Stroke[] {
  let timestamp = 0;
  return groups.map((indices, groupIndex) => ({
    id: `joined-${groupIndex}`,
    width: 5,
    points: indices.flatMap((strokeIndex, indexWithinGroup) => strokes[strokeIndex].points.map((point, pointIndex) => ({
      ...point,
      timestamp: timestamp += pointIndex === 0 && indexWithinGroup > 0 ? pauseMs : 12,
    }))),
  }));
}

describe("real hanzi_lookup WASM", () => {
  it("recognises dense noisy Apple Pencil-style 听 and 写 input after preprocessing", async () => {
    const lookup = await loadLookup();
    for (const character of ["听", "写"]) {
      const raw = denseStrokes(character);
      const converted = convertStrokesForRecognizer(raw);
      expect(converted.flat().length).toBeLessThan(raw.flatMap((stroke) => stroke.points).length / 3);
      const matches = lookup(converted, 15);
      expect(matches.findIndex((match) => match.hanzi === character)).toBeGreaterThanOrEqual(0);
      expect(matches.findIndex((match) => match.hanzi === character)).toBeLessThan(5);
    }
  });

  it("keeps all seven canonical target characters within the fused top 15", async () => {
    const lookup = await loadLookup();
    for (const character of ["听", "写", "老", "师", "飞", "机", "场"]) {
      const variants = createRecognitionVariants(medianStrokes(character));
      const results = variants.map((variant) => ({ variantId: variant.id, matches: lookup(variant.input, 40) }));
      const fused = fuseRecognitionResults(variants, results, 15);
      expect(fused.findIndex((candidate) => candidate.character === character), character).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses timing variants on connected forms of all seven targets", async () => {
    const lookup = await loadLookup();
    const fixtures: Array<[string, number[][]]> = [
      ["听", [[0, 1, 2], [3, 4], [5, 6]]],
      ["写", [[0, 1], [2], [3, 4]]],
      ["老", [[0, 1], [2, 3], [4, 5]]],
      ["师", [[0, 1], [2, 3], [4, 5]]],
      ["飞", [[0, 1], [2]]],
      ["机", [[0, 1], [2, 3], [4, 5]]],
      ["场", [[0, 1], [2, 3], [4, 5]]],
    ];
    for (const [character, groups] of fixtures) {
      const strokes = joinStrokes(medianStrokes(character), groups, 110);
      const variants = createRecognitionVariants(strokes);
      expect(variants.some((variant) => variant.family === "pause"), character).toBe(true);
      const results = variants.map((variant) => ({ variantId: variant.id, matches: lookup(variant.input, 40) }));
      const pauseResult = results.find((result) => result.variantId === "pause")!;
      expect(pauseResult.matches.findIndex((candidate) => candidate.hanzi === character), character).toBeGreaterThanOrEqual(0);
      expect(pauseResult.matches.findIndex((candidate) => candidate.hanzi === character), character).toBeLessThan(15);
    }
  });

  it("offers corner interpretations for connected strokes without timing pauses", async () => {
    const lookup = await loadLookup();
    for (const [character, groups] of [
      ["听", [[0, 1, 2], [3, 4], [5, 6]]],
      ["写", [[0, 1], [2], [3, 4]]],
    ] as Array<[string, number[][]]>) {
      const variants = createRecognitionVariants(joinStrokes(medianStrokes(character), groups, 12));
      const cornerVariants = variants.filter((variant) => variant.family === "corner45" || variant.family === "corner90");
      expect(cornerVariants.length, character).toBeGreaterThan(0);
      const results = variants.map((variant) => ({ variantId: variant.id, matches: lookup(variant.input, 40) }));
      const bestCornerRank = Math.min(...cornerVariants.map((variant) => results.find((result) => result.variantId === variant.id)!.matches.findIndex((match) => match.hanzi === character)).filter((rank) => rank >= 0));
      expect(bestCornerRank, character).toBeLessThan(20);
    }
  });

  it("repairs an accidental lift before the real WASM lookup", async () => {
    const lookup = await loadLookup();
    const canonical = medianStrokes("写");
    const source = canonical[3];
    const splitIndex = 6;
    const first = { ...source, id: "split-first", points: source.points.slice(0, splitIndex + 1).map((point) => ({ ...point })) };
    const lastTimestamp = first.points.at(-1)!.timestamp;
    const second = {
      ...source,
      id: "split-second",
      points: source.points.slice(splitIndex).map((point, index) => ({
        ...point,
        timestamp: lastTimestamp + 50 + index * 12,
      })),
    };
    const captured = [...canonical.slice(0, 3), first, second, ...canonical.slice(4)];
    const variants = createRecognitionVariants(captured);
    const merge = variants.find((variant) => variant.family === "merge");
    expect(merge).toBeDefined();
    const matches = lookup(merge!.input, 40);
    expect(matches.findIndex((candidate) => candidate.hanzi === "写")).toBeGreaterThanOrEqual(0);
    expect(matches.findIndex((candidate) => candidate.hanzi === "写")).toBeLessThan(15);
  });

  it("documents the deliberate false-accept risk of a top-15 threshold", async () => {
    const lookup = await loadLookup();
    const exposedConfusables: Record<string, string> = {
      "昕": "听",
      "帅": "师",
      "扬": "场",
      "汤": "场",
    };
    for (const [written, target] of Object.entries(exposedConfusables)) {
      const variants = createRecognitionVariants(medianStrokes(written));
      const results = variants.map((variant) => ({ variantId: variant.id, matches: lookup(variant.input, 40) }));
      const fused = fuseRecognitionResults(variants, results, 15);
      expect(fused.findIndex((candidate) => candidate.character === target), `${written} may be accepted as ${target}`).toBeGreaterThanOrEqual(0);
    }

    const variants = createRecognitionVariants(medianStrokes("杌"));
    const results = variants.map((variant) => ({ variantId: variant.id, matches: lookup(variant.input, 40) }));
    expect(fuseRecognitionResults(variants, results, 15).some((candidate) => candidate.character === "机"), "stroke count keeps 杌 distinct from 机").toBe(false);
  });
});
