// LINE renders text literally. Keep a plain-text fallback if a model still
// emits common Markdown syntax despite the prompt.
export function toPlainText(value) {
  return value
    .replace(/```[^\n]*\n([\s\S]*?)```/g,'$1')
    .replace(/```/g,'')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'$1 ($2)')
    .replace(/^\s{0,3}#{1,6}\s+/gm,'')
    .replace(/^\s*>\s?/gm,'')
    .replace(/^\s*[-*+]\s+/gm,'')
    .replace(/\*\*([^\n]+?)\*\*/g,'$1')
    .replace(/__([^\n]+?)__/g,'$1')
    .replace(/(^|\s)_([^_\n]+)_(?=$|\s|[.,!?])/g,'$1$2')
    .replace(/\*([^\n*]+)\*/g,'$1')
    .replace(/`([^`\n]+)`/g,'$1')
    .replace(/^\s*\d+[.)]\s+/gm,'')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm,'')
    .replace(/^\s*\|(.+)\|\s*$/gm,(_row,cells)=>cells.split('|').map(cell=>cell.trim()).join(' / '))
    .trim();
}
