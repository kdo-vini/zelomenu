import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

// SortableList — reusable drag-to-reorder list primitive for the catalog admin
// (reordering categories, and products within a category).
//
// It owns the drag handle + drag affordance + spacing only; the parent's
// `renderItem` controls the row content so inner buttons/links keep working.
// Works on touch (mobile-first), mouse, and keyboard.

export type SortableListProps<T> = {
  items: T[];
  /** Stable unique id for each item (string|number). */
  getId: (item: T) => string | number;
  /** Render the row CONTENT (not the handle — the list provides the handle). */
  renderItem: (item: T, index: number) => ReactNode;
  /** Called with the full reordered array after a drag completes. */
  onReorder: (reordered: T[]) => void;
  /** Optional: disable dragging (e.g. while persisting). */
  disabled?: boolean;
  /** Optional extra classes on the list container. */
  className?: string;
  /** Optional extra classes on each draggable row wrapper. */
  rowClassName?: string;
};

// Shared row chrome so the draggable and static rows look identical.
const ROW_CLASS =
  'flex items-stretch gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]';
const HANDLE_CLASS =
  'flex min-h-[44px] min-w-[44px] shrink-0 touch-none select-none items-center justify-center self-stretch rounded-l-xl';

type RowProps = {
  id: string;
  children: ReactNode;
  rowClassName?: string;
};

function SortableRow({ id, children, rowClassName = '' }: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${ROW_CLASS} ${rowClassName} ${isDragging ? 'z-10 opacity-90 shadow-md' : ''}`}
    >
      <button
        type="button"
        aria-label="Reordenar"
        className={`${HANDLE_CLASS} cursor-grab text-[var(--color-ink-faint)] outline-none hover:text-[var(--color-ink-soft)] focus-visible:text-[var(--color-ink-soft)] active:cursor-grabbing`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1 self-center">{children}</div>
    </div>
  );
}

type StaticRowProps = {
  children: ReactNode;
  rowClassName?: string;
};

// Rendered when `disabled` — no sensors/listeners, dimmed handle.
function StaticRow({ children, rowClassName = '' }: StaticRowProps) {
  return (
    <div className={`${ROW_CLASS} ${rowClassName}`}>
      <div className={`${HANDLE_CLASS} text-[var(--color-ink-faint)] opacity-40`}>
        <GripVertical className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 self-center">{children}</div>
    </div>
  );
}

export function SortableList<T,>({
  items,
  getId,
  renderItem,
  onReorder,
  disabled = false,
  className = '',
  rowClassName = '',
}: SortableListProps<T>): ReactElement {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small movement threshold so taps still fire as clicks / let the page scroll.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const containerClass = `flex flex-col gap-2 ${className}`.trim();

  if (disabled) {
    return (
      <div className={containerClass}>
        {items.map((item, index) => (
          <StaticRow key={getId(item)} rowClassName={rowClassName}>{renderItem(item, index)}</StaticRow>
        ))}
      </div>
    );
  }

  const ids = items.map((item) => String(getId(item)));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    // arrayMove returns a new array — props are never mutated.
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={containerClass}>
          {items.map((item, index) => (
            <SortableRow key={getId(item)} id={String(getId(item))} rowClassName={rowClassName}>
              {renderItem(item, index)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
