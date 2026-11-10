import type { Folder, Node } from 'fumadocs-core/page-tree'
import schema from '@/public/openapi.json'

const operationPaths = new Map(Object.entries(schema.paths).flatMap(([path, methods]) =>
  Object.values(methods).map(operation => [operation.operationId.replaceAll('_', '-'), path] as const),
))

const referenceGroups = {
  'reference/collection': [
    { name: 'Binders', path: /^\/binders(?:\/\{id\}|\/order)?$/ },
    { name: 'Collection', path: /^\/collection(?:\/\{pokemonId\})?$/ },
    { name: 'History & recovery', path: /^\/collection\/(audit|recovery)(\/|$)/ },
    { name: 'Imports', path: /^\/imports\// },
    { name: 'Sharing & appearance', path: /^\/(binders\/\{binderId\}\/(identity|sharing)|appearance|artwork)(\/|$)/ },
    { name: 'Show purchases', path: /^\/show-purchases(\/|$)/ },
    { name: 'Inventory', path: /^\/inventory\// },
    { name: 'Presets', path: /^\/storage\/presets(?:\/|$)/ },
    { name: 'Native storage', path: /^\/storage\/(?!presets(?:\/|$))/ },
  ],
  'reference/prices-and-insights': [
    { name: 'Prices', path: /^\/(prices|price-checks)(\/|$)/ },
    { name: 'Comparisons', path: /^\/comparison-jobs(\/|$)/ },
    { name: 'Analytics', path: /^\/analytics(\/|$)/ },
    { name: 'Deal checks', path: /^\/(deals|listings)(\/|$)/ },
  ],
}

// Group the sidebar only: generated pages, Markdown exports and saved URLs keep their original paths.
export function groupReferenceNavigation(folder: Folder, folderPath: string): Folder {
  if (folderPath !== 'reference') return folder
  return {
    ...folder,
    children: folder.children.flatMap<Node>(node => {
      if (node.type !== 'folder') return [node]
      const groups = referenceGroups[node.$ref?.folder as keyof typeof referenceGroups]
      if (!groups) return [node]
      const children = groups.map(group => ({
        type: 'folder' as const,
        name: group.name,
        $id: `${node.$id}/${group.name}`,
        defaultOpen: false,
        children: node.children.filter(child => child.type === 'page' &&
          group.path.test(operationPaths.get(child.url.split('/').at(-1)!) ?? '')),
      })).filter(group => group.children.length > 0)
      const grouped = new Set(children.flatMap(group => group.children))
      // Keep newly added operations visible until their subject group is assigned.
      const remaining = node.children.filter(child => !grouped.has(child))
      return [...children, ...(remaining.length ? [{ ...node, name: 'Other operations', children: remaining }] : [])]
    }),
  }
}
