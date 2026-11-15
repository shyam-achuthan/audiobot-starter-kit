// Zero code points of Indic digit blocks (each block is 10 consecutive digits).
const INDIC_ZEROS = [
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
];

/** "९८४५०" -> "98450": converts Indian-script digits to ASCII. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g, (ch) => {
    const cp = ch.codePointAt(0)!;
    const zero = INDIC_ZEROS.find((z) => cp >= z && cp <= z + 9)!;
    return String(cp - zero);
  });
}

/**
 * Normalises phone numbers spoken/typed by Indian callers to E.164.
 * "98450 12345", "098450-12345", "+91 9845012345", "919845012345", "९८४५०१२३४५" -> "+919845012345".
 * Returns null when the input can't be a valid number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const ascii = toAsciiDigits(input);
  const hadPlus = ascii.trim().startsWith('+');
  let d = ascii.replace(/\D/g, '');
  if (!d) return null;

  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.slice(2))) return `+${d}`;
  // Other countries: accept E.164-length numbers only when explicitly prefixed with +.
  if (hadPlus && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}
