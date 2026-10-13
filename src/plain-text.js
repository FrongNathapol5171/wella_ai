// LINE renders text literally. Keep a plain-text fallback if a model still
// emits common Markdown syntax despite the prompt.
export function toPlainText(value) {
  return value
    .replace(/\r\n?/g,'\n')
    .replace(/```[^\n]*\n([\s\S]*?)```/g,'$1')
    .replace(/```/g,'')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'$1 ($2)')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm,'')
    .replace(/^[ \t]*>[ \t]?/gm,'')
    .replace(/^[ \t]*[-*+][ \t]+/gm,'')
    .replace(/\*\*([^\n]+?)\*\*/g,'$1')
    .replace(/__([^\n]+?)__/g,'$1')
    .replace(/(^|\s)_([^_\n]+)_(?=$|\s|[.,!?])/g,'$1$2')
    .replace(/\*([^\n*]+)\*/g,'$1')
    .replace(/`([^`\n]+)`/g,'$1')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm,'')
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm,'')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm,(_row,cells)=>cells.split('|').map(cell=>cell.trim()).join(' / '))
    .trim();
}

export function formatLineText(value) {
  return toPlainText(value)
    // Separate run-on Thai replies at polite endings without consuming newlines.
    .replace(/(ค่ะ|คะ)([.!?…]*)[ \t]+(?=\S)/g,'$1$2\n\n')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
