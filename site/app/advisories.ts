export const NO_INFORMATION_ADVISORY = /\b(cannot|can't|impossible to|unable to|insufficient|no specific|not enough|lack(?:s|ing)? (?:of )?(?:artist|venue|genre|presentation|specific)|not provided|no .{0,24}(?:data|detail|information)s? provided|(?:currently |is |are |remains? )?unverified|is a single performer|depends on (?:your |personal |musical )?(?:interest|preference|taste))\b/i;

export function isGroundedAdvisory(entry: { explanation: string } | null | undefined) {
  return Boolean(entry?.explanation) && !NO_INFORMATION_ADVISORY.test(entry!.explanation);
}
