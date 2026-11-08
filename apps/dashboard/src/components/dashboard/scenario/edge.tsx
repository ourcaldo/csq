import { memo } from "react";
import {
  getBezierPath,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

// Custom edge: the default bezier path plus a small × button at the midpoint
// for one-click deletion (visible on hover). This makes "delete the line
// between two modules" obvious and mouse-friendly, complementing the
// right-click context menu's insert/delete actions.

function DeleteEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        d={edgePath}
        className="react-flow__edge-path"
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="scn-edge-del nodrag nopan pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-xs text-slate-600 shadow-sm hover:bg-red-50 hover:text-red-600"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          onClick={(e) => {
            e.stopPropagation();
            setEdges((eds) => eds.filter((ed) => ed.id !== id));
          }}
          aria-label="Hapus koneksi"
          title="Hapus koneksi"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const DeleteEdge = memo(DeleteEdgeImpl);

export const edgeTypes = { default: DeleteEdge };
