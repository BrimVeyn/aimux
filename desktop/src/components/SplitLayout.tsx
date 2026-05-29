import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TerminalPane } from "@/components/TerminalPane";
import { aimuxToRrpDirection } from "@/lib/split";
import type { LayoutNode, ProjectedTab, TerminalSnapshot } from "@/lib/types";

interface SplitLayoutProps {
  node: LayoutNode;
  activeTabId: string | null;
  tabsById: Record<string, ProjectedTab>;
  renders: Record<string, { viewport: TerminalSnapshot } | undefined>;
  onResizeTab: (tabId: string, cols: number, rows: number) => void;
  onActivate: (tabId: string) => void;
  onScroll: (deltaLines: number) => void;
  onSetSplitRatio: (tabId: string, ratio: number, axis: "horizontal" | "vertical") => void;
}

// Recursive render of aimux's layout tree. Panels are uncontrolled
// (defaultSize from the tree); after a drag we sync the ratio back to the host,
// which is the source of truth. We re-key on structure so the projection wins.
export function SplitLayout(props: SplitLayoutProps) {
  const { node } = props;

  if (node.type === "leaf") {
    return (
      <TerminalPane
        tabId={node.tabId}
        tab={props.tabsById[node.tabId]}
        snapshot={props.renders[node.tabId]?.viewport ?? null}
        isActive={node.tabId === props.activeTabId}
        onResizeTab={props.onResizeTab}
        onActivate={props.onActivate}
        onScroll={props.onScroll}
      />
    );
  }

  const orientation = aimuxToRrpDirection(node.direction);
  // The tab id used to locate this split in the reducer = first leaf of `first`.
  const anchorTabId = firstLeafId(node.first);
  const structureKey = treeStructureKey(node);
  const firstPanelId = `${structureKey}::first`;
  const secondPanelId = `${structureKey}::second`;

  return (
    <ResizablePanelGroup
      key={structureKey}
      orientation={orientation}
      onLayoutChanged={(layout) => {
        const first = layout[firstPanelId];
        const second = layout[secondPanelId];
        if (typeof first === "number" && typeof second === "number" && first + second > 0) {
          props.onSetSplitRatio(anchorTabId, first / (first + second), node.direction);
        }
      }}
      className="h-full w-full"
    >
      <ResizablePanel id={firstPanelId} defaultSize={node.ratio * 100}>
        <SplitLayout {...props} node={node.first} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id={secondPanelId} defaultSize={(1 - node.ratio) * 100}>
        <SplitLayout {...props} node={node.second} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function firstLeafId(node: LayoutNode): string {
  return node.type === "leaf" ? node.tabId : firstLeafId(node.first);
}

// Stable key from the tree's leaf ids + structure so React remounts the panel
// group (resetting defaultSize) when the tree changes shape, not on every ratio
// tweak. Ratio is intentionally excluded so dragging doesn't remount mid-drag.
function treeStructureKey(node: LayoutNode): string {
  if (node.type === "leaf") {
    return node.tabId;
  }
  return `${node.direction}(${treeStructureKey(node.first)},${treeStructureKey(node.second)})`;
}
