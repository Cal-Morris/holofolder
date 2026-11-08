import { defineConfig, defineDocs } from 'fumadocs-mdx/config'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: { postprocess: { includeProcessedMarkdown: {
    output: 'function', headingIds: false,
    filterElement(node) {
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && (node.name === 'div' || node.name === 'p')) return 'children-only'
      return true
    },
  } } },
})
export default defineConfig()
