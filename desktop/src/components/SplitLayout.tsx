import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TerminalPane } from "@/components/TerminalPane";
import { aimuxToRrpDirection } from "@/lib/split";
import type { LayoutNode, ProjectedTab } from "@/lib/types";

interface SplitLayoutProps {
  activeTabId: string | null;
  bytesEmitter: EventTarget;
  node: LayoutNode;
  onActivate: (tabId: string) => void;
  onRequestBytes: (tabId: string) => void;
  onResizeTab: (tabId: string, cols: number, rows: number) => void;
  onSetSplitRatio: (tabId: string, ratio: number, axis: "horizontal" | "vertical") => void;
  tabsById: Record<string, ProjectedTab>;
  themeId: string;
}

// Recursive render of aimux's layout tree. Panels are uncontrolled
// (defaultSize from the tree); after a drag we sync the ratio back to the host,
// which is the source of truth. We re-key on structure so the projection wins.
export function SplitLayout(props: SplitLayoutProps) {
  const { node } = props;

  if (node.type === "leaf") {
    return (
      <TerminalPane
        bytesEmitter={props.bytesEmitter}
        isActive={node.tabId === props.activeTabId}
        onActivate={props.onActivate}
        onRequestBytes={props.onRequestBytes}
        onResizeTab={props.onResizeTab}
        tab={props.tabsById[node.tabId]}
        tabId={node.tabId}
        themeId={props.themeId}
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
