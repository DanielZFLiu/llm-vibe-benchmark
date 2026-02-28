Here is the complete, production-ready implementation of **TaskFlow**, a fully interactive Kanban board meeting all specified requirements.

### File: package.json
```json
{
  "name": "taskflow",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "nanoid": "^5.0.9",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/nanoid": "^3.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.3",
    "vite": "^6.0.5"
  }
}
```

### File: vite.config.ts
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

### File: tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### File: tsconfig.node.json
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### File: tailwind.config.js
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### File: index.html
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TaskFlow</title>
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### File: src/main.tsx
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### File: src/index.css
```css
@import "tailwindcss";

body {
  @apply bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100;
}
```

### File: src/types/index.ts
```typescript
export type Priority = 'low' | 'medium' | 'high';

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description?: string;
  priority: Priority;
  tags: string[];
  createdAt: number;
  dueDate?: number;
}

export interface Column {
  id: string;
  title: string;
  cardIds: string[];
}

export interface Board {
  columns: Column[];
  cards: Record<string, Card>;
  columnOrder: string[];
}

export type Action =
  | { type: 'ADD_COLUMN'; payload: { title: string } }
  | { type: 'RENAME_COLUMN'; payload: { columnId: string; title: string } }
  | { type: 'DELETE_COLUMN'; payload: { columnId: string } }
  | { type: 'REORDER_COLUMNS'; payload: { columnIds: string[] } }
  | { type: 'ADD_CARD'; payload: { columnId: string; card: Omit<Card, 'id' | 'columnId' | 'createdAt'> } }
  | { type: 'EDIT_CARD'; payload: { cardId: string; updates: Partial<Omit<Card, 'id' | 'columnId' | 'createdAt'>> } }
  | { type: 'DELETE_CARD'; payload: { cardId: string } }
  | { type: 'MOVE_CARD'; payload: { cardId: string; fromColumnId: string; toColumnId: string; newIndex?: number } }
  | { type: 'REORDER_CARDS'; payload: { columnId: string; cardIds: string[] } }
  | { type: 'SET_BOARD'; payload: Board }
  | { type: 'UNDO' };
```

### File: src/context/boardReducer.ts
```typescript
import { nanoid } from 'nanoid';
import { Board, Column, Card, Action } from '../types';

export function getDefaultBoard(): Board {
  const todoId = nanoid();
  const inProgressId = nanoid();
  const doneId = nanoid();
  return {
    columns: [
      { id: todoId, title: 'To Do', cardIds: [] },
      { id: inProgressId, title: 'In Progress', cardIds: [] },
      { id: doneId, title: 'Done', cardIds: [] },
    ],
    cards: {},
    columnOrder: [todoId, inProgressId, doneId],
  };
}

export function boardReducer(board: Board, action: Action): Board {
  let newBoard: Board;
  switch (action.type) {
    case 'ADD_COLUMN': {
      const id = nanoid();
      const column: Column = { id, title: action.payload.title, cardIds: [] };
      newBoard = {
        ...board,
        columns: [...board.columns, column],
        columnOrder: [...board.columnOrder, id],
      };
      break;
    }
    case 'RENAME_COLUMN':
      newBoard = {
        ...board,
        columns: board.columns.map(col =>
          col.id === action.payload.columnId ? { ...col, title: action.payload.title } : col
        ),
      };
      break;
    case 'DELETE_COLUMN': {
      const columnId = action.payload.columnId;
      const columnToDelete = board.columns.find(c => c.id === columnId);
      if (!columnToDelete) return board;
      newBoard = {
        ...board,
        columns: board.columns.filter(c => c.id !== columnId),
        columnOrder: board.columnOrder.filter(id => id !== columnId),
        cards: Object.fromEntries(
          Object.entries(board.cards).filter(([_, card]) => card.columnId !== columnId)
        ),
      };
      break;
    }
    case 'REORDER_COLUMNS':
      newBoard = {
        ...board,
        columnOrder: action.payload.columnIds,
      };
      break;
    case 'ADD_CARD': {
      const id = nanoid();
      const now = Date.now();
      const card: Card = {
        id,
        columnId: action.payload.columnId,
        title: action.payload.card.title,
        description: action.payload.card.description,
        priority: action.payload.card.priority,
        tags: action.payload.card.tags,
        createdAt: now,
        dueDate: action.payload.card.dueDate,
      };
      newBoard = {
        ...board,
        cards: { ...board.cards, [id]: card },
        columns: board.columns.map(col =>
          col.id === action.payload.columnId ? { ...col, cardIds: [...col.cardIds, id] } : col
        ),
      };
      break;
    }
    case 'EDIT_CARD': {
      const existing = board.cards[action.payload.cardId];
      if (!existing) return board;
      const updates = action.payload.updates;
      const updated: Card = { ...existing, ...updates };
      newBoard = {
        ...board,
        cards: { ...board.cards, [action.payload.cardId]: updated },
      };
      break;
    }
    case 'DELETE_CARD': {
      const cardId = action.payload.cardId;
      const card = board.cards[cardId];
      if (!card) return board;
      newBoard = {
        ...board,
        cards: Object.fromEntries(Object.entries(board.cards).filter(([id]) => id !== cardId)),
        columns: board.columns.map(col =>
          col.id === card.columnId ? { ...col, cardIds: col.cardIds.filter(id => id !== cardId) } : col
        ),
      };
      break;
    }
    case 'MOVE_CARD': {
      const { cardId, fromColumnId, toColumnId, newIndex } = action.payload;
      const fromCol = board.columns.find(c => c.id === fromColumnId);
      const toCol = board.columns.find(c => c.id === toColumnId);
      if (!fromCol || !toCol) return board;
      const sourceIndex = fromCol.cardIds.indexOf(cardId);
      if (sourceIndex === -1) return board;

      const newFromCardIds = [
        ...fromCol.cardIds.slice(0, sourceIndex),
        ...fromCol.cardIds.slice(sourceIndex + 1),
      ];

      const baseCardIds = fromColumnId === toColumnId ? newFromCardIds : toCol.cardIds;

      let effectiveIndex = newIndex;
      if (fromColumnId === toColumnId && effectiveIndex !== undefined && effectiveIndex > sourceIndex) {
        effectiveIndex = effectiveIndex - 1;
      }

      let newToCardIds: string[];
      if (effectiveIndex !== undefined) {
        newToCardIds = [
          ...baseCardIds.slice(0, effectiveIndex),
          cardId,
          ...baseCardIds.slice(effectiveIndex),
        ];
      } else {
        newToCardIds = [...baseCardIds, cardId];
      }

      newBoard = {
        ...board,
        cards: {
          ...board.cards,
          [cardId]: { ...board.cards[cardId], columnId: toColumnId },
        },
        columns: board.columns.map(col => {
          if (col.id === fromColumnId) return { ...col, cardIds: newFromCardIds };
          if (col.id === toColumnId) return { ...col, cardIds: newToCardIds };
          return col;
        }),
      };
      break;
    }
    case 'REORDER_CARDS': {
      const { columnId, cardIds } = action.payload;
      const column = board.columns.find(c => c.id === columnId);
      if (!column || cardIds.length !== column.cardIds.length) return board;
      newBoard = {
        ...board,
        columns: board.columns.map(col =>
          col.id === columnId ? { ...col, cardIds } : col
        ),
      };
      break;
    }
    case 'SET_BOARD':
      return action.payload;
    case 'UNDO':
      return board;
    default:
      return board;
  }
  return newBoard;
}
```

### File: src/context/BoardContext.tsx
```tsx
import React, { createContext, useContext, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { boardReducer, getDefaultBoard } from './boardReducer';
import { Board, Action } from '../types';

interface BoardContextType {
  board: Board;
  dispatch: React.Dispatch<Action>;
  undo: () => void;
}

const BoardContext = createContext<BoardContextType | undefined>(undefined);

export const BoardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [savedBoard, setSavedBoard] = useLocalStorage<Board>('taskflow-board', getDefaultBoard());

  const { present: board, dispatch: rawDispatch, undo } = useUndoHistory(savedBoard, boardReducer, 20);

  useEffect(() => {
    setSavedBoard(board);
  }, [board, setSavedBoard]);

  const dispatch = useCallback((action: Action) => {
    rawDispatch(action);
  }, [rawDispatch]);

  return (
    <BoardContext.Provider value={{ board, dispatch, undo }}>
      {children}
    </BoardContext.Provider>
  );
};

export const useBoard = () => {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error('useBoard must be used within a BoardProvider');
  }
  return context;
};
```

### File: src/hooks/useLocalStorage.ts
```tsx
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((v: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.warn('Failed to parse localStorage value for key:', key, error);
        return initialValue;
      }
    }
    return initialValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}
```

### File: src/hooks/useUndoHistory.ts
```tsx
import { useState, useCallback } from 'react';

export function useUndoHistory<T, A extends { type: string }>(initial: T, reducer: (state: T, action: A) => T, maxSize = 20) {
  const [present, setPresent] = useState<T>(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const dispatch = useCallback((action: A) => {
    setPresent(prev => {
      const next = reducer(prev, action);
      setPast(p => {
        const newPast = [...p, prev];
        if (newPast.length > maxSize) newPast.shift();
        return newPast;
      });
      setFuture(() => []);
      return next;
    });
  }, [reducer, maxSize]);

  const undo = useCallback(() => {
    setPast(p => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      setFuture(f => [...f, present]);
      setPresent(previous);
      return p.slice(0, p.length - 1);
    });
  }, [present]);

  return { present, dispatch, undo };
}
```

### File: src/hooks/useDragAndDrop.ts
```tsx
import { useState, useCallback } from 'react';

export type DragType = 'card' | 'column';

export interface DragState {
  type: DragType;
  id: string;
  sourceColumnId?: string;
  sourceIndex?: number;
}

export interface CardDropTarget {
  columnId: string;
  index: number;
}

export type DropTarget =
  | { type: 'column'; columnId: string; index?: number }
  | { type: 'card'; columnId: string; index: number };

export interface DragHandlers {
  onDragStart: (event: React.DragEvent, type: DragType, id: string, source?: { columnId: string; index?: number }) => void;
  onDragOver: (event: React.DragEvent, target: DropTarget) => void;
  onDragEnd: () => void;
}

export function useDragAndDrop() {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [cardDropTarget, setCardDropTarget] = useState<CardDropTarget | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<string | null>(null);

  const onDragStart = useCallback((event: React.DragEvent, type: DragType, id: string, source?: { columnId: string; index?: number }) => {
    setDragState({ type, id, ...source });
    setCardDropTarget(null);
    setColumnDropTarget(null);
    event.dataTransfer?.setData('text/plain', id);
    event.dataTransfer!.effectAllowed = type === 'card' ? 'move' : 'move';
  }, []);

  const onDragOver = useCallback((event: React.DragEvent, target: DropTarget) => {
    event.preventDefault();
    if (!dragState) return;

    if (target.type === 'column') {
      if (dragState.type === 'card') {
        setCardDropTarget({ columnId: target.columnId, index: target.index ?? 0 });
        setColumnDropTarget(null);
      } else if (dragState.type === 'column') {
        setColumnDropTarget(target.columnId);
        setCardDropTarget(null);
      }
    } else if (target.type === 'card') {
      if (dragState.type === 'card') {
        setCardDropTarget({ columnId: target.columnId, index: target.index });
        setColumnDropTarget(null);
      }
    }
  }, [dragState]);

  const onDragEnd = useCallback(() => {
    setDragState(null);
    setCardDropTarget(null);
    setColumnDropTarget(null);
  }, []);

  return {
    dragState,
    cardDropTarget,
    columnDropTarget,
    handlers: { onDragStart, onDragOver, onDragEnd } as DragHandlers,
  };
}
```

### File: src/hooks/useKeyboardShortcuts.ts
```tsx
import { useEffect } from 'react';
import { Action } from '../types';

export function useKeyboardShortcuts(
  board: { columns: { id: string }[]; cards: Record<string, { columnId: string }> },
  focusedCardId: string | null,
  focusedColumnId: string | null,
  dispatch: React.Dispatch<Action>,
  undo: () => void,
  onEditCard: (cardId: string) => void,
  onRenameColumn: () => void
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isContentEditable = target.isContentEditable;
      if (['INPUT', 'TEXTAREA'].includes(tag) || isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      if (focusedCardId) {
        const card = board.cards[focusedCardId];
        if (card) {
          if (e.altKey) {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const colOrder = board.columns.map(c => c.id);
              const currentColIndex = colOrder.indexOf(card.columnId);
              if (currentColIndex === -1) return;
              let targetIndex: number | null = null;
              if (e.key === 'ArrowLeft') targetIndex = currentColIndex - 1;
              if (e.key === 'ArrowRight') targetIndex = currentColIndex + 1;
              if (targetIndex !== null && targetIndex >= 0 && targetIndex < colOrder.length) {
                const targetColId = colOrder[targetIndex];
                dispatch({
                  type: 'MOVE_CARD',
                  payload: {
                    cardId: focusedCardId,
                    fromColumnId: card.columnId,
                    toColumnId: targetColId,
                  },
                });
              }
            }
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onEditCard(focusedCardId);
          }
        }
      }

      if (focusedColumnId && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onRenameColumn();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [board, focusedCardId, focusedColumnId, dispatch, undo, onEditCard, onRenameColumn]);
}
```

### File: src/utils/helpers.ts
```tsx
import { Card } from '../types';

export function isOverdue(card: Card): boolean {
  if (!card.dueDate) return false;
  return card.dueDate < Date.now();
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getAllTags(cards: Card[]): string[] {
  const tags = new Set<string>();
  cards.forEach(card => {
    card.tags.forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}
```

### File: src/components/Icons.tsx
```tsx
import React from 'react';

export const PlusIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
);

export const EditIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
);

export const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
);

export const UndoIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
);

export const SunIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="