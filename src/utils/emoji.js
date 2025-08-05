export const emojiRegex = /(\p{Extended_Pictographic})/u;

export function isValidEmoji (str = '') {
  return emojiRegex.test(str);
}
