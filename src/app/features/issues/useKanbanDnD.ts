import { useEffect, useRef, useState } from 'react';

export type KanbanDropResult = {
  issueId: string;
  sourceColumn: string;
  targetColumn: string;
  kanbanFieldKey: string;
  targetCardId: string | null;
  targetEdge: 'top' | 'bottom' | null;
};

// Monitor for all drops across the board. Call once at IssueBoard level.
export function useKanbanMonitor(
  onDrop: (result: KanbanDropResult) => void,
  active: boolean
): void {
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    Promise.all([
      import('@atlaskit/pragmatic-drag-and-drop/element/adapter'),
      import('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'),
    ]).then(([{ monitorForElements }, { extractClosestEdge }]) => {
      if (cancelled) return;
      cleanup = monitorForElements({
        canMonitor: ({ source }) => source.data.type === 'kanban-card',
        onDrop({ source, location }) {
          const targets = location.current.dropTargets;
          const cardTarget = targets.find((t) => t.data.type === 'kanban-card');
          const colTarget = targets.find((t) => t.data.type === 'kanban-column');
          const hit = cardTarget ?? colTarget;
          if (!hit) return;
          onDropRef.current({
            issueId: source.data.issueId as string,
            sourceColumn: source.data.columnValue as string,
            targetColumn: hit.data.columnValue as string,
            kanbanFieldKey: source.data.kanbanFieldKey as string,
            targetCardId: cardTarget ? (cardTarget.data.issueId as string) : null,
            targetEdge: cardTarget
              ? (extractClosestEdge(cardTarget.data) as 'top' | 'bottom' | null)
              : null,
          });
        },
      });
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [active]);
}

// Combined hook: makes a card both draggable and a drop target (closest-edge).
export function useKanbanCardDnD(
  issueId: string,
  columnValue: string,
  kanbanFieldKey: string,
  canWrite: boolean
): { ref: React.RefObject<HTMLDivElement>; isDragging: boolean; closestEdge: 'top' | 'bottom' | null } {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<'top' | 'bottom' | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    Promise.all([
      import('@atlaskit/pragmatic-drag-and-drop/element/adapter'),
      import('@atlaskit/pragmatic-drag-and-drop/combine'),
      import('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'),
    ]).then(([{ draggable, dropTargetForElements }, { combine }, { attachClosestEdge, extractClosestEdge }]) => {
      if (cancelled || !ref.current) return;
      const dragData = { type: 'kanban-card', issueId, columnValue, kanbanFieldKey };
      cleanup = combine(
        ...(canWrite
          ? [draggable({
              element: ref.current,
              getInitialData: () => dragData,
              onDragStart: () => setIsDragging(true),
              onDrop: () => setIsDragging(false),
            })]
          : []),
        dropTargetForElements({
          element: ref.current,
          canDrop: ({ source }) =>
            source.data.type === 'kanban-card' && source.data.issueId !== issueId,
          getData: ({ input, element }) =>
            attachClosestEdge(dragData, { input, element, allowedEdges: ['top', 'bottom'] }),
          onDrag: ({ self }) =>
            setClosestEdge(extractClosestEdge(self.data) as 'top' | 'bottom' | null),
          onDragLeave: () => setClosestEdge(null),
          onDrop: () => setClosestEdge(null),
        })
      );
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [issueId, columnValue, kanbanFieldKey, canWrite]);

  return { ref, isDragging, closestEdge };
}

// Column drop target (fallback when not hovering a specific card).
export function useKanbanDropTarget(
  columnValue: string,
  kanbanFieldKey: string
): { ref: React.RefObject<HTMLElement>; isOver: boolean } {
  const ref = useRef<HTMLElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    import('@atlaskit/pragmatic-drag-and-drop/element/adapter').then(({ dropTargetForElements }) => {
      if (cancelled || !ref.current) return;
      cleanup = dropTargetForElements({
        element: ref.current,
        canDrop: ({ source }) => source.data.type === 'kanban-card',
        getData: () => ({ type: 'kanban-column', columnValue, kanbanFieldKey }),
        onDragEnter: () => setIsOver(true),
        onDragLeave: () => setIsOver(false),
        onDrop: () => setIsOver(false),
      });
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [columnValue, kanbanFieldKey]);

  return { ref, isOver };
}
