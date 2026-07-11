import {
  getCharacterShapeReference,
  SUPPORTED_SHAPE_CHARACTERS,
  type ShapePoint,
  type SupportedShapeCharacter,
} from "./character-shape-references";

/**
 * Pinned median-stroke data from hanzi-writer-data revision
 * 68d10a4b21150cae5e1ebbd223eed289cf32d90c.
 *
 * The source data is derived from Make Me a Hanzi and distributed under the
 * Arphic Public License (see public/licenses/Arphic-Public-License.txt).
 * Source coordinates use a y-up 1024-unit square whose top is y=900; this
 * module returns the same screen-friendly y-down coordinates as
 * character-shape-references.ts.
 */

type RawPoint = readonly [number, number];
type RawCharacterMedians = readonly (readonly RawPoint[])[];

export type KnownShapeCompetitorCharacter = "昕" | "帅" | "扬" | "汤" | "杌";
export type ShapeCompetitorSource = "known-confusable" | "supported-target";

export interface ShapeCompetitor {
  character: string;
  /** Human-readable glyph label for diagnostics and feedback. */
  label: string;
  source: ShapeCompetitorSource;
  paths: ShapePoint[][];
}

const RAW_CONFUSABLE_MEDIANS: Record<KnownShapeCompetitorCharacter, RawCharacterMedians> = {
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

const KNOWN_CONFUSABLES: Partial<Record<SupportedShapeCharacter, readonly KnownShapeCompetitorCharacter[]>> = {
  "听": ["昕"],
  "师": ["帅"],
  "机": ["杌"],
  "场": ["扬", "汤"],
};

function clonePaths(paths: readonly (readonly ShapePoint[])[]): ShapePoint[][] {
  return paths.map((path) => path.map((point) => ({ x: point.x, y: point.y })));
}

function confusableReference(character: KnownShapeCompetitorCharacter): ShapePoint[][] {
  return RAW_CONFUSABLE_MEDIANS[character].map((stroke) =>
    stroke.map(([x, y]) => ({ x, y: 900 - y })),
  );
}

/**
 * Return negative shape references for a supported expected character.
 * Known high-risk confusables appear first, followed by every other supported
 * target character. Every call returns fresh point objects so consumers can
 * safely transform candidates without mutating the pinned source data.
 */
export function getShapeCompetitors(expected: string): ShapeCompetitor[] {
  if (!SUPPORTED_SHAPE_CHARACTERS.includes(expected as SupportedShapeCharacter)) return [];

  const known = (KNOWN_CONFUSABLES[expected as SupportedShapeCharacter] ?? []).map((character) => ({
    character,
    label: character,
    source: "known-confusable" as const,
    paths: confusableReference(character),
  }));
  const supported = SUPPORTED_SHAPE_CHARACTERS
    .filter((character) => character !== expected)
    .map((character) => ({
      character,
      label: character,
      source: "supported-target" as const,
      paths: clonePaths(getCharacterShapeReference(character) ?? []),
    }));

  return [...known, ...supported];
}
