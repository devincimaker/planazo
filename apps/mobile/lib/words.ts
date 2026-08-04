// Small counts read better spelled out mid-sentence: "35 photos from five
// people" rather than "from 5 people". Plan detail keeps its own capitalised
// list for headlines that open with the number ("Two short on the night"),
// which is a different job and a different casing.
const WORDS = [
  'no one',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Spelled out up to ten, digits beyond that. */
export function spellCount(n: number): string {
  return WORDS[n] ?? String(n);
}
