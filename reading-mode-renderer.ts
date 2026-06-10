import {
  CommentParseOptions,
  ParsedComment,
  containsCommentMarkup,
  findCommentsAcrossSegments,
} from "./comment-core";

export interface ReadingModeRenderOptions {
  parseOptions?: CommentParseOptions;
  createCommentElement: (
    comment: ParsedComment,
    ownerDocument: Document
  ) => HTMLElement;
}

export function renderCommentMarkupInReadingMode(
  root: HTMLElement,
  options: ReadingModeRenderOptions
): number {
  let renderedCount = 0;

  for (const textNodes of collectReadingModeTextNodeGroups(root)) {
    renderedCount += renderSegmentedCommentsInReadingMode(textNodes, options);
  }

  return renderedCount;
}

export function collectReadingModeTextNodeGroups(root: HTMLElement): Text[][] {
  // Obsidian may run Markdown postprocessors before a table-cell wrapper is
  // attached to the document. `isConnected` is false in that window, so detached
  // preview DOM must be treated as renderable as long as nodes still have parents.
  const textNodes: Text[] = [];
  const nodeFilter = getNodeFilter(root.ownerDocument);
  const walker = root.ownerDocument.createTreeWalker(
    root,
    nodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return nodeFilter.FILTER_REJECT;
        if (parent.closest("pre")) return nodeFilter.FILTER_REJECT;
        if (parent.closest(".review-comment-highlight, .review-comment-point")) {
          return nodeFilter.FILTER_REJECT;
        }
        return nodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  const groups = new Map<Element, Text[]>();
  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent) continue;
    const groupRoot =
      parent.closest(
        ".table-cell-wrapper, td, th, p, li, blockquote, h1, h2, h3, h4, h5, h6, .callout, .markdown-preview-section > div"
      ) || parent;
    const existing = groups.get(groupRoot);
    if (existing) {
      existing.push(textNode);
    } else {
      groups.set(groupRoot, [textNode]);
    }
  }

  return [...groups.values()];
}

function renderSegmentedCommentsInReadingMode(
  textNodes: Text[],
  options: ReadingModeRenderOptions
): number {
  const renderableTextNodes = textNodes.filter((node) => node.parentElement);
  if (renderableTextNodes.length === 0) return 0;

  const segments = renderableTextNodes.map((node) => node.textContent || "");
  const source = segments.join("");
  if (!containsCommentMarkup(source)) return 0;

  let renderedCount = 0;
  const comments = findCommentsAcrossSegments(segments, options.parseOptions);
  const ownerDocument = getOwnerDocument(renderableTextNodes[0]);
  for (const segmented of comments.reverse()) {
    if (isSegmentedCommentFullyInsideCodeLike(renderableTextNodes, segmented.spans)) {
      continue;
    }

    if (
      replaceSegmentedCommentInReadingMode(
        renderableTextNodes,
        segmented.spans,
        options.createCommentElement(segmented.comment, ownerDocument)
      )
    ) {
      renderedCount += 1;
    }
  }

  return renderedCount;
}

function replaceSegmentedCommentInReadingMode(
  textNodes: Text[],
  spans: { segmentIndex: number; start: number; end: number }[],
  replacement: HTMLElement
): boolean {
  const firstSpan = spans[0];
  const lastSpan = spans[spans.length - 1];
  if (!firstSpan || !lastSpan) return false;

  const startNode = textNodes[firstSpan.segmentIndex];
  const endNode = textNodes[lastSpan.segmentIndex];
  if (!startNode?.parentElement || !endNode?.parentElement) return false;

  const ownerDocument = getOwnerDocument(startNode);
  try {
    const range = ownerDocument.createRange();
    range.setStart(startNode, firstSpan.start);
    range.setEnd(endNode, lastSpan.end);
    range.deleteContents();
    range.insertNode(replacement);
    range.detach();
    return true;
  } catch {
    return false;
  }
}

function isSegmentedCommentFullyInsideCodeLike(
  textNodes: Text[],
  spans: { segmentIndex: number; start: number; end: number }[]
): boolean {
  if (spans.length === 0) return false;
  return spans.every((span) => {
    const textNode = textNodes[span.segmentIndex];
    return Boolean(textNode?.parentElement?.closest("code, pre"));
  });
}

function getOwnerDocument(node: Node): Document {
  return node.ownerDocument || document;
}

function getNodeFilter(ownerDocument: Document): typeof NodeFilter {
  return ownerDocument.defaultView?.NodeFilter || NodeFilter;
}
