# TaskFlow - Kanban Board Application

### File: package.json

```json
{
  "name": "taskflow",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "nanoid": "^5.0.9",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.3"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^4.0.0",
    "typescript": "~5.6.2",
    "vite": "^6.0.3"
  }
}
```

### File: vite.config.ts

```tsx
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

### File: index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TaskFlow - Kanban Board</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### File: src/main.tsx

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### File: src/index.css

```css
@import "tailwindcss";

@theme {
  --color-primary-50: #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
}

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 4px;
}

.dark ::-webkit-scrollbar-thumb {
  background: #475569;
}

::-webkit-scrollbar-thumb:hover {
  background: #64748b;
}

/* Markdown content styling */
.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4,
.markdown-content h5,
.markdown-content h6 {
  font-weight: 600;
  margin-top: 0.5em;
  margin-bottom: 0.25em;
}

.markdown-content p {
  margin-bottom: 0.5em;
}

.markdown-content a {
  color: #3b82f6;
  text-decoration: underline;
}

.dark .markdown-content a {
  color: #60a5fa;
}

.markdown-content ul,
.markdown-content ol {
  padding-left: 1.5em;
  margin-bottom: 0.5em;
}

.markdown-content li {
  margin-bottom: 0.25em;
}

.markdown-content code {
  background: #e2e8f0;
  padding: 0.125em 0.25em;
  border-radius: 0.25em;
  font-size: 0.875em;
}

.dark .markdown-content code {
  background: #334155;
}

.markdown-content blockquote {
  border-left: 3px solid #3b82f6;
  padding-left: 0.75em;
  margin-left: 0;
  color: #64748b;
}

.dark .markdown-content blockquote {
  color: #94a3b8;
}

/* Animation keyframes */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.animate-fadeIn {
  animation: fadeIn 0.2s ease-out;
}

.animate-slideIn {
  animation: slideIn 0.2s ease-out;
}

.animate-scaleIn {
  animation: scaleIn 0.15s ease-out;
}
```

### File: src/types/index.ts

```tsx
export type Priority = 'low' | 'medium' | 'high';

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  tags: string[];
  createdAt: string;
  dueDate: string | null;
}

export interface Column {
  id: string;
  title: string;
}

export interface FilterState {
  search: string;
  priorities: Priority[];
  tags: string[];
}

export interface BoardState {
  columns: Column[];
  cards: Card[];
  filters: FilterState;
  isDarkMode: boolean;
}

export type BoardAction =
  | { type: 'ADD_COLUMN'; payload: { id: string; title: string } }
  | { type: 'RENAME_COLUMN'; payload: { id: string; title: string } }
  | { type: 'DELETE_COLUMN'; payload: { id: string } }
  | { type: 'REORDER_COLUMNS'; payload: { sourceIndex: number; destinationIndex: number } }
  | { type: 'ADD_CARD'; payload: Card }
  | { type: 'UPDATE_CARD'; payload: { id: string; updates: Partial<Omit<Card, 'id' | 'createdAt'>> } }
  | { type: 'DELETE_CARD'; payload: { id: string } }
  | { type: 'MOVE_CARD'; payload: { cardId: string; targetColumnId: string; targetIndex: number } }
  | { type: 'REORDER_CARDS'; payload: { columnId: string; sourceIndex: number; destinationIndex: number } }
  | { type: 'SET_FILTERS'; payload: Partial<FilterState> }
  | { type: 'TOGGLE_DARK_MODE' }
  | { type: 'SET_STATE'; payload: BoardState }
  | { type: 'RESTORE'; payload: BoardState };

export interface UndoAction {
  type: BoardAction['type'];
  previousState: BoardState;
  description: string;
}
```

### File: src/utils/helpers.ts

```tsx
import { nanoid } from 'nanoid';
import { Card, Column, Priority } from '../types';

export function generateId(): string {
  return nanoid(12);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < now;
}

export function isDueSoon(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  due.setHours(0, 0, 0, 0);
  threeDaysFromNow.setHours(0, 0, 0, 0);
  return due >= now && due <= threeDaysFromNow;
}

export function getPriorityColor(priority: Priority): string {
  switch (priority) {
    case 'high':
      return 'bg-red-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-green-500';
    default:
      return 'bg-gray-500';
  }
}

export function getPriorityTextColor(priority: Priority): string {
  switch (priority) {
    case 'high':
      return 'text-red-700 dark:text-red-400';
    case 'medium':
      return 'text-yellow-700 dark:text-yellow-400';
    case 'low':
      return 'text-green-700 dark:text-green-400';
    default:
      return 'text-gray-700 dark:text-gray-400';
  }
}

export function getAllTags(cards: Card[]): string[] {
  const tagSet = new Set<string>();
  cards.forEach((card) => {
    card.tags.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

export function filterCards(
  cards: Card[],
  filters: { search: string; priorities: Priority[]; tags: string[] }
): { card: Card; isDimmed: boolean }[] {
  const { search, priorities, tags } = filters;
  const searchLower = search.toLowerCase();

  return cards.map((card) => {
    const matchesSearch =
      search === '' ||
      card.title.toLowerCase().includes(searchLower) ||
      card.description.toLowerCase().includes(searchLower);

    const matchesPriority = priorities.length === 0 || priorities.includes(card.priority);

    const matchesTags = tags.length === 0 || tags.some((tag) => card.tags.includes(tag));

    const isDimmed = !matchesSearch || !matchesPriority || !matchesTags;

    return { card, isDimmed };
  });
}

export function getDefaultColumns(): Column[] {
  return [
    { id: generateId(), title: 'To Do' },
    { id: generateId(), title: 'In Progress' },
    { id: generateId(), title: 'Done' },
  ];
}

export function getDefaultState(): import('../types').BoardState {
  return {
    columns: getDefaultColumns(),
    cards: [],
    filters: {
      search: '',
      priorities: [],
      tags: [],
    },
    isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
  };
}
```

### File: src/context/BoardContext.tsx

```tsx
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { BoardState, BoardAction, UndoAction, Card, Column } from '../types';
import { getDefaultState } from '../utils/helpers';

const STORAGE_KEY = 'taskflow-board';
const MAX_UNDO_HISTORY = 20;

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<BoardAction>;
  undo: () => void;
  canUndo: boolean;
  pushUndo: (action: BoardAction, previousState: BoardState, description: string) => void;
}

const BoardContext = createContext<BoardContextType | undefined>(undefined);

function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'ADD_COLUMN': {
      return {
        ...state,
        columns: [...state.columns, { id: action.payload.id, title: action.payload.title }],
      };
    }

    case 'RENAME_COLUMN': {
      return {
        ...state,
        columns: state.columns.map((col) =>
          col.id === action.payload.id ? { ...col, title: action.payload.title } : col
        ),
      };
    }

    case 'DELETE_COLUMN': {
      return {
        ...state,
        columns: state.columns.filter((col) => col.id !== action.payload.id),
        cards: state.cards.filter((card) => card.columnId !== action.payload.id),
      };
    }

    case 'REORDER_COLUMNS': {
      const { sourceIndex, destinationIndex } = action.payload;
      const newColumns = [...state.columns];
      const [removed] = newColumns.splice(sourceIndex, 1);
      newColumns.splice(destinationIndex, 0, removed);
      return { ...state, columns: newColumns };
    }

    case 'ADD_CARD': {
      return {
        ...state,
        cards: [...state.cards, action.payload],
      };
    }

    case 'UPDATE_CARD': {
      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.payload.id ? { ...card, ...action.payload.updates } : card
        ),
      };
    }

    case 'DELETE_CARD': {
      return {
        ...state,
        cards: state.cards.filter((card) => card.id !== action.payload.id),
      };
    }

    case 'MOVE_CARD': {
      const { cardId, targetColumnId, targetIndex } = action.payload;
      const cardToMove = state.cards.find((c) => c.id === cardId);
      if (!cardToMove) return state;

      const otherCards = state.cards.filter((c) => c.id !== cardId);
      const targetColumnCards = otherCards
        .filter((c) => c.columnId === targetColumnId)
        .sort((a, b) => {
          const indexA = state.columns.find((col) => col.id === a.columnId)
            ? otherCards.indexOf(a)
            : 0;
          return indexA;
        });

      const cardWithNewColumn = { ...cardToMove, columnId: targetColumnId };
      const columnCardsWithoutMoved = otherCards.filter((c) => c.columnId !== targetColumnId);
      const finalTargetCards = [
        ...columnCardsWithoutMoved.filter((c) => c.columnId !== targetColumnId),
        ...state.cards.filter((c) => c.columnId === targetColumnId && c.id !== cardId),
      ];

      const before = finalTargetCards.slice(0, targetIndex);
      const after = finalTargetCards.slice(targetIndex);
      const newCards = [
        ...state.cards.filter((c) => c.columnId !== targetColumnId && c.id !== cardId),
        ...before,
        cardWithNewColumn,
        ...after,
      ];

      return { ...state, cards: newCards };
    }

    case 'REORDER_CARDS': {
      const { columnId, sourceIndex, destinationIndex } = action.payload;
      const columnCards = state.cards
        .filter((c) => c.columnId === columnId)
        .sort((a, b) => state.cards.indexOf(a) - state.cards.indexOf(b));

      const [removed] = columnCards.splice(sourceIndex, 1);
      columnCards.splice(destinationIndex, 0, removed);

      const otherCards = state.cards.filter((c) => c.columnId !== columnId);
      const reorderedCards = columnCards.map((card) => {
        const originalIndex = state.cards.findIndex((c) => c.id === card.id);
        return { card, originalIndex };
      });

      const newCards = [
        ...otherCards,
        ...columnCards.map((card) => card),
      ];

      return { ...state, cards: newCards };
    }

    case 'SET_FILTERS': {
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };
    }

    case 'TOGGLE_DARK_MODE': {
      return {
        ...state,
        isDarkMode: !state.isDarkMode,
      };
    }

    case 'SET_STATE': {
      return action.payload;
    }

    case 'RESTORE': {
      return action.payload;
    }

    default:
      return state;
  }
}

function loadState(): BoardState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as BoardState;
      if (
        parsed &&
        Array.isArray(parsed.columns) &&
        Array.isArray(parsed.cards) &&
        typeof parsed.isDarkMode === 'boolean'
      ) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load state from localStorage:', e);
  }
  return getDefaultState();
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, undefined, loadState);

  const [undoHistory, setUndoHistory] = React.useState<UndoAction[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state to localStorage:', e);
    }
  }, [state]);

  useEffect(() => {
    if (state.isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.isDarkMode]);

  const pushUndo = useCallback(
    (action: BoardAction, previousState: BoardState, description: string) => {
      setUndoHistory((prev) => {
        const newHistory = [...prev, { type: action.type, previousState, description }];
        if (newHistory.length > MAX_UNDO_HISTORY) {
          return newHistory.slice(-MAX_UNDO_HISTORY);
        }
        return newHistory;
      });
    },
    []
  );

  const undo = useCallback(() => {
    setUndoHistory((prev) => {
      if (prev.length === 0) return prev;
      const lastAction = prev[prev.length - 1];
      dispatch({ type: 'RESTORE', payload: lastAction.previousState });
      return prev.slice(0, -1);
    });
  }, []);

  const canUndo = undoHistory.length > 0;

  return (
    <BoardContext.Provider value={{ state, dispatch, undo, canUndo, pushUndo }}>
      {children}
    </BoardContext.Provider>
  );
}

export function useBoard() {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error('useBoard must be used within a BoardProvider');
  }
  return context;
}
```

### File: src/hooks/useKeyboardShortcuts.ts

```tsx
import { useEffect, useCallback } from 'react';
import { useBoard } from '../context/BoardContext';
import { Card } from '../types';

interface UseKeyboardShortcutsOptions {
  selectedCardId: string | null;
  onEditCard: (card: Card) => void;
}

export function useKeyboardShortcuts({ selectedCardId, onEditCard }: UseKeyboardShortcutsOptions) {
  const { undo, canUndo, dispatch } = useBoard();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (canUndo) {
          undo();
        }
        return;
      }

      if (selectedCardId) {
        if (e.key === 'Enter' || e.key === ' ') {
          const target = e.target as HTMLElement;
          if (target.closest('.card-item')) {
            e.preventDefault();
            const card = document.querySelector(`[data-card-id="${selectedCardId}"]`);
            if (card) {
              const cardData = JSON.parse(card.getAttribute('data-card') || '{}') as Card;
              onEditCard(cardData);
            }
          }
        }

        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const cardElement = document.querySelector(`[data-card-id="${selectedCardId}"]`);
          if (!cardElement) return;

          const columnId = cardElement.getAttribute('data-column-id');
          if (!columnId) return;

          const columns = Array.from(document.querySelectorAll('[data-column-id]'));
          const currentColumnIndex = columns.findIndex(
            (col) => col.getAttribute('data-column-id') === columnId
          );

          if (e.key === 'ArrowLeft' && currentColumnIndex > 0) {
            const targetColumn = columns[currentColumnIndex - 1];
            const targetColumnId = targetColumn.getAttribute('data-column-id');
            if (targetColumnId) {
              const targetCards = targetColumn.querySelectorAll('.card-item');
              dispatch({
                type: 'MOVE_CARD',
                payload: {
                  cardId: selectedCardId,
                  targetColumnId,
                  targetIndex: targetCards.length,
                },
              });
            }
          } else if (e.key === 'ArrowRight' && currentColumnIndex < columns.length - 1) {
            const targetColumn = columns[currentColumnIndex + 1];
            const targetColumnId = targetColumn.getAttribute('data-column-id');
            if (targetColumnId) {
              const targetCards = targetColumn.querySelectorAll('.card-item');
              dispatch({
                type: 'MOVE_CARD',
                payload: {
                  cardId: selectedCardId,
                  targetColumnId,
                  targetIndex: targetCards.length,
                },
              });
            }
          }
        }
      }
    },
    [undo, canUndo, selectedCardId, dispatch, onEditCard]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

### File: src/components/SearchBar.tsx

```tsx
import { useBoard } from '../context/BoardContext';
import { clsx } from 'clsx';

export function SearchBar() {
  const { state, dispatch } = useBoard();
  const { search } = state.filters;

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => dispatch({ type: 'SET_FILTERS', payload: { search: e.target.value } })}
          placeholder="Search cards..."
          className={clsx(
            'pl-10 pr-4 py-2 rounded-lg border text-sm w-64 transition-colors',
            'bg-white dark:bg-gray-800',
            'border-gray-200 dark:border-gray-700',
            'focus:outline-none focus:ring-2 focus:ring-primary-500',
            'placeholder-gray-400 dark:placeholder-gray-500',
            'text-gray-900 dark:text-gray-100'
          )}
          aria-label="Search cards"
        />
      </div>
      {search && (
        <button
          onClick={() => dispatch({ type: 'SET_FILTERS', payload: { search: '' } })}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label="Clear search"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

### File: src/components/FilterPanel.tsx

```tsx
import { useBoard } from '../context/BoardContext';
import { getAllTags } from '../utils/helpers';
import { Priority } from '../types';
import { clsx } from 'clsx';

const priorities: Priority[] = ['low', 'medium', 'high'];

export function FilterPanel() {
  const { state, dispatch } = useBoard();
  const { priorities: selectedPriorities, tags: selectedTags } = state.filters;
  const allTags = getAllTags(state.cards);

  const togglePriority = (priority: Priority) => {
    const newPriorities = selectedPriorities.includes(priority)
      ? selectedPriorities.filter((p) => p !== priority)
      : [...selectedPriorities, priority];
    dispatch({ type: 'SET_FILTERS', payload: { priorities: newPriorities } });
  };

  const toggleTag = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    dispatch({ type: 'SET_FILTERS', payload: { tags: newTags } });
  };

  const clearFilters = () => {
    dispatch({ type: 'SET_FILTERS', payload: { priorities: [], tags: [] } });
  };

  const hasFilters = selectedPriorities.length > 0 || selectedTags.length > 0;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">Priority:</span>
        <div className="flex gap-1">
          {priorities.map((priority) => (
            <button
              key={priority}
              onClick={() => togglePriority(priority)}
              className={clsx(
                'px-3 py-1 text-xs rounded-full capitalize transition-colors',
                selectedPriorities.includes(priority)
                  ? priority === 'high'
                    ? 'bg-red-500 text-white'
                    : priority === 'medium'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-green-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
              aria-pressed={selectedPriorities.includes(priority)}
            >
              {priority}
            </button>
          ))}
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Tags:</span>
          <div className="flex gap-1 flex-wrap">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={clsx(
                  'px-2 py-1 text-xs rounded-full transition-colors',
                  selectedTags.includes(tag)
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                )}
                aria-pressed={selectedTags.includes(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasFilters && (
        <button
          onClick={clearFilters}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
```

### File: src/components/CardModal.tsx

```tsx
import { useState, useEffect, useRef } from 'react';
import { Card, Priority } from '../types';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';

interface CardModalProps {
  card?: Card | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<Card, 'id' | 'createdAt'> & { id?: string }) => void;
  columnId: string;
}

const priorities: Priority[] = ['low', 'medium', 'high'];

export function CardModal({ card, isOpen, onClose, onSave, columnId }: CardModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [tagsInput, setTagsInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setDescription(card.description);
      setPriority(card.priority);
      setTagsInput(card.tags.join(', '));
      setDueDate(card.dueDate || '');
    } else {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setTagsInput('');
      setDueDate('');
    }
  }, [card, isOpen]);

  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    onSave({
      id: card?.id,
      columnId,
      title: title.trim().slice(0, 100),
      description,
      priority,
      tags,
      dueDate: dueDate || null,
      createdAt: card?.createdAt || new Date().toISOString(),
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scaleIn"
        onKeyDown={handleKeyDown}
      >
        <form onSubmit={handleSubmit} className="p-6">
          <h2 id="modal-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
            {card ? 'Edit Card' : 'Create New Card'}
          </h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                ref={titleInputRef}
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                required
                className={clsx(
                  'w-full px-3 py-2 rounded-lg border text-sm transition-colors',
                  'bg-white dark:bg-gray-800',
                  'border-gray-200 dark:border-gray-700',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500',
                  'text-gray-900 dark:text-gray-100',
                  'placeholder-gray-400 dark:placeholder-gray-500'
                )}
                placeholder="Enter card title..."
              />
              <p className="text-xs text-gray-400 mt-1">{title.length}/100 characters</p>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description <span className="text-gray-400">(supports Markdown)</span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className={clsx(
                    'w-full px-3 py-2 rounded-lg border text-sm transition-colors resize-none',
                    'bg-white dark:bg-gray-800',
                    'border-gray-200 dark:border-gray-700',
                    'focus:outline-none focus:ring-2 focus:ring-primary-500',
                    'text-gray-900 dark:text-gray-100',
                    'placeholder-gray-400 dark:placeholder-gray-500'
                  )}
                  placeholder="Add a description... (supports **bold**, *italic*, [links](url), lists)"
                />
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 overflow-y-auto bg-gray-50 dark:bg-gray-800/50">
                  {description ? (
                    <div className="markdown-content text-sm text-gray-700 dark:text-gray-300">
                      <ReactMarkdown>{description}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Preview will appear here...</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Priority
                </label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className={clsx(
                    'w-full px-3 py-2 rounded-lg border text-sm transition-colors',
                    'bg-white dark:bg-gray-800',
                    'border-gray-200 dark:border-gray-700',
                    'focus:outline-none focus:ring-2 focus:ring-primary-500',
                    'text-gray-900 dark:text-gray-100'
                  )}
                >
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Due Date
                </label>
                <input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={clsx(
                    'w-full px-3 py-2 rounded-lg border text-sm transition-colors',
                    'bg-white dark:bg-gray-800',
                    'border-gray-200 dark:border-gray-700',
                    'focus:outline-none focus:ring-2 focus:ring-primary-500',
                    'text-gray-900 dark:text-gray-100'
                  )}
                />
              </div>
            </div>

            <div>
              <label htmlFor="tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tags <span className="text-gray-400">(comma-separated)</span>
              </label>
              <input
                id="tags"
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className={clsx(
                  'w-full px-3 py-2 rounded-lg border text-sm transition-colors',
                  'bg-white dark:bg-gray-800',
                  'border-gray-200 dark:border-gray-700',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500',
                  'text-gray-900 dark:text-gray-100',
                  'placeholder-gray-400 dark:placeholder-gray-500'
                )}
                placeholder="e.g., work, urgent, bug"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className={clsx(
                'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
                'bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {card ? 'Save Changes' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### File: src/components/Card.tsx

```tsx
import { useState, useRef, useEffect } from 'react';
import { Card, Priority } from '../types';
import { clsx } from 'clsx';
import { formatDate, isOverdue, isDueSoon, getPriorityColor, getPriorityTextColor } from '../utils/helpers';
import ReactMarkdown from 'react-markdown';

interface CardProps {
  card: Card;
  onEdit: (card: Card) => void;
  onDelete: (id: string) => void;
  isDimmed: boolean;
  onDragStart: (e: React.DragEvent, card: Card) => void;
  onDragEnd: (e: React.DragEvent) => void;
  isDragging: boolean;
}

export function CardComponent({
  card,
  onEdit,
  onDelete,
  isDimmed,
  onDragStart,
  onDragEnd,
  isDragging,
}: CardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement === cardRef.current) {
          e.preventDefault();
          onDelete(card.id);
        }
      }
    };

    cardRef.current?.addEventListener('keydown', handleKeyDown);
    return () => cardRef.current?.removeEventListener('keydown', handleKeyDown);
  }, [card.id, onDelete]);

  const overdue = isOverdue(card.dueDate);
  const dueSoon = isDueSoon(card.dueDate);

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      role="article"
      aria-label={`Card: ${card.title}`}
      data-card-id={card.id}
      data-card={JSON.stringify(card)}
      data-column-id={card.columnId}
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      onDragEnd={onDragEnd}
      onClick={() => onEdit(card)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(card);
        }
      }}
      className={clsx(
        'card-item group relative bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700',
        'cursor-grab active:cursor-grabbing transition-all duration-200',
        'hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600',
        'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
        isDimmed && 'opacity-40',
        isDragging && 'opacity-50 scale-95'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm line-clamp-2">
          {card.title}
        </h3>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(card.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
          aria-label="Delete card"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span
          className={clsx(
            'w-2 h-2 rounded-full',
            getPriorityColor(card.priority)
          )}
          aria-label={`Priority: ${card.priority}`}
        />
        <span className={clsx('text-xs', getPriorityTextColor(card.priority))}>
          {card.priority}
        </span>
      </div>

      {card.description && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className={clsx(
            'text-xs text-gray-600 dark:text-gray-400 mb-2 cursor-pointer',
            !isExpanded && 'line-clamp-2'
          )}
        >
          <ReactMarkdown>{card.description}</ReactMarkdown>
        </div>
      )}

      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {card.dueDate && (
        <div
          className={clsx(
            'text-xs flex items-center gap-1',
            overdue ? 'text-red-600 dark:text-red-400 font-medium' : dueSoon ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'
          )}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {overdue ? 'Overdue: ' : ''}
          {formatDate(card.dueDate)}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2">
        Created {formatDate(card.createdAt)}
      </p>
    </div>
  );
}
```

### File: src/components/Column.tsx

```tsx
import { useState, useRef, useEffect } from 'react';
import { Column as ColumnType, Card } from '../types';
import { CardComponent } from './Card';
import { clsx } from 'clsx';
import { generateId } from '../utils/helpers';

interface ColumnProps {
  column: ColumnType;
  cards: Card[];
  onAddCard: (columnId: string) => void;
  onEditCard: (card: Card) => void;
  onDeleteCard: (id: string) => void;
  onRenameColumn: (id: string, title: string) => void;
  onDeleteColumn: (id: string) => void;
  isDraggingOver: boolean;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, columnId: string, index: number) => void;
  draggedCard: Card | null;
  onDragStart: (e: React.DragEvent, card: Card) => void;
  onDragEnd: (e: React.DragEvent) => void;
  isDraggingCard: boolean;
  dimmedCards: Set<string>;
}

export function Column({
  column,
  cards,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onRenameColumn,
  onDeleteColumn,
  isDraggingOver,
  onDragOver,
  onDragLeave,
  onDrop,
  draggedCard,
  onDragStart,
  onDragEnd,
  isDraggingCard,
  dimmedCards,
}: ColumnProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(column.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleTitleSubmit = () => {
    if (title.trim()) {
      onRenameColumn(column.id, title.trim());
    } else {
      setTitle(column.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setTitle(column.title);
      setIsEditing(false);
    }
  };

  const hasCards = cards.length > 0;

  return (
    <div
      data-column-id={column.id}
      className={clsx(
        'flex-shrink-0 w-80 bg-gray-100 dark:bg-gray-900 rounded-xl p-4 flex flex-col max-h-full transition-colors',
        isDraggingOver && 'ring-2 ring-primary-500 ring-inset bg-primary-50 dark:bg-primary-900/20'
      )}
      onDragOver={(e) => onDragOver(e, column.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, column.id, cards.length)}
    >
      <div className="flex items-center justify-between mb-4">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleKeyDown}
            className="flex-1 px-2 py-1 text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        ) : (
          <h2
            tabIndex={0}
            role="button"
            aria-label={`Column: ${column.title}. Press Enter to rename.`}
            onClick={() => setIsEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsEditing(true);
              }
            }}
            className="text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100"
          >
            {column.title}
            <span className="ml-2 text-xs text-gray-400">({cards.length})</span>
          </h2>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={() => onAddCard(column.id)}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            aria-label={`Add card to ${column.title}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            aria-label={`Delete column ${column.title}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 min-h-[100px]">
        {cards.map((card, index) => (
          <div key={card.id}>
            {draggedCard && isDraggingCard && (
              <div
                className={clsx(
                  'h-1 bg-primary-500 rounded-full mb-2 transition-all',
                  cards.indexOf(draggedCard) === index - 1 ? 'opacity-100' : 'opacity-0'
                )}
              />
            )}
            <CardComponent
              card={card}
              onEdit={onEditCard}
              onDelete={onDeleteCard}
              isDimmed={dimmedCards.has(card.id)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              isDragging={draggedCard?.id === card.id}
            />
          </div>
        ))}
        {cards.length === 0 && (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
            No cards yet
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full shadow-xl animate-scaleIn">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Delete Column?
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {hasCards
                ? `This column contains ${cards.length} card${cards.length > 1 ? 's' : ''}. Are you sure you want to delete it?`
                : `Are you sure you want to delete "${column.title}"?`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeleteColumn(column.id);
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### File: src/components/Board.tsx

```tsx
import { useState, useCallback, useMemo, useRef } from 'react';
import { useBoard } from '../context/BoardContext';
import { Column } from './Column';
import { CardModal } from './CardModal';
import { Card, Priority } from '../types';
import { generateId, filterCards } from '../utils/helpers';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { clsx } from 'clsx';

export function Board() {
  const { state, dispatch, pushUndo } = useBoard();
  const { columns, cards, filters } = state;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [targetColumnId, setTargetColumnId] = useState<string | null>(null);
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const { filteredResults, dimmedCardIds } = useMemo(() => {
    const results = filterCards(cards, filters);
    const dimmed = new Set(results.filter((r) => r.isDimmed).map((r) => r.card.id));
    return { filteredResults: results, dimmedCardIds: dimmed };
  }, [cards, filters]);

  const getCardsForColumn = useCallback(
    (columnId: string) => {
      return filteredResults
        .filter((r) => r.card.columnId === columnId)
        .map((r) => r.card);
    },
    [filteredResults]
  );

  const handleAddColumn = useCallback(() => {
    const newColumn = { id: generateId(), title: 'New Column' };
    pushUndo(
      { type: 'ADD_COLUMN', payload: newColumn },
      { ...state },
      'Add column'
    );
    dispatch({ type: 'ADD_COLUMN', payload: newColumn });
  }, [dispatch, pushUndo, state]);

  const handleAddCard = useCallback(
    (columnId: string) => {
      setTargetColumnId(columnId);
      setEditingCard(null);
      setModalOpen(true);
    },
    []
  );

  const handleEditCard = useCallback((card: Card) => {
    setEditingCard(card);
    setTargetColumnId(card.columnId);
    setModalOpen(true);
  }, []);

  const handleSaveCard = useCallback(
    (data: Omit<Card, 'id' | 'createdAt'> & { id?: string }) => {
      if (data.id) {
        const existingCard = cards.find((c) => c.id === data.id);
        if (existingCard) {
          pushUndo(
            { type: 'UPDATE_CARD', payload: { id: data.id, updates: data } },
            { ...state },
            'Update card'
          );
        }
        dispatch({ type: 'UPDATE_CARD', payload: { id: data.id, updates: data } });
      } else {
        const newCard: Card = {
          id: generateId(),
          columnId: data.columnId,
          title: data.title,
          description: data.description,
          priority: data.priority,
          tags: data.tags,
          createdAt: new Date().toISOString(),
          dueDate: data.dueDate,
        };
        pushUndo(
          { type: 'ADD_CARD', payload: newCard },
          { ...state },
          'Add card'
        );
        dispatch({ type: 'ADD_CARD', payload: newCard });
      }
    },
    [dispatch, pushUndo, state, cards]
  );

  const handleDeleteCard = useCallback(
    (id: string) => {
      const card = cards.find((c) => c.id === id);
      if (card) {
        pushUndo(
          { type: 'DELETE_CARD', payload: { id } },
          { ...state },
          'Delete card'
        );
        dispatch({ type: 'DELETE_CARD', payload: { id } });
      }
    },
    [dispatch, pushUndo, state, cards]
  );

  const handleRenameColumn = useCallback(
    (id: string, title: string) => {
      const column = columns.find((c) => c.id === id);
      if (column && column.title !== title) {
        pushUndo(
          { type: 'RENAME_COLUMN', payload: { id, title } },
          { ...state },
          'Rename column'
        );
        dispatch({ type: 'RENAME_COLUMN', payload: { id, title } });
      }
    },
    [dispatch, pushUndo, state, columns]
  );

  const handleDeleteColumn = useCallback(
    (id: string) => {
      pushUndo(
        { type: 'DELETE_COLUMN', payload: { id } },
        { ...state },
        'Delete column'
      );
      dispatch({ type: 'DELETE_COLUMN', payload: { id } });
    },
    [dispatch, pushUndo, state]
  );

  const handleDragStart = useCallback((e: React.DragEvent, card: Card) => {
    setDraggedCard(card);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedCard(null);
    setIsDraggingOver(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggingOver(columnId);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDraggingOver(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, columnId: string, index: number) => {
      e.preventDefault();
      if (draggedCard) {
        const currentColumnCards = cards
          .filter((c) => c.columnId === columnId)
          .sort((a, b) => cards.indexOf(a) - cards.indexOf(b));

        let targetIndex = index;
        if (draggedCard.columnId === columnId) {
          const currentIndex = currentColumnCards.findIndex((c) => c.id === draggedCard.id);
          if (currentIndex < index) {
            targetIndex = index - 1;
          }
        }

        pushUndo(
          { type: 'MOVE_CARD', payload: { cardId: draggedCard.id, targetColumnId: columnId, targetIndex } },
          { ...state },
          'Move card'
        );
        dispatch({
          type: 'MOVE_CARD',
          payload: { cardId: draggedCard.id, targetColumnId: columnId, targetIndex },
        });
      }
      setDraggedCard(null);
      setIsDraggingOver(null);
    },
    [dispatch, draggedCard, cards, pushUndo, state]
  );

  const handleCardFocus = useCallback((cardId: string | null) => {
    setSelectedCardId(cardId);
  }, []);

  useKeyboardShortcuts({
    selectedCardId,
    onEditCard: handleEditCard,
  });

  return (
    <div className="flex flex-col h-full">
      <div
        ref={boardRef}
        className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6"
        role="region"
        aria-label="Kanban board"
      >
        <div className="flex gap-4 h-full">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={getCardsForColumn(column.id)}
              onAddCard={handleAddCard}
              onEditCard={handleEditCard}
              onDeleteCard={handleDeleteCard}
              onRenameColumn={handleRenameColumn}
              onDeleteColumn={handleDeleteColumn}
              isDraggingOver={isDraggingOver === column.id}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              draggedCard={draggedCard}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              isDraggingCard={!!draggedCard}
              dimmedCards={dimmedCardIds}
            />
          ))}

          <button
            onClick={handleAddColumn}
            className={clsx(
              'flex-shrink-0 w-80 h-24 rounded-xl border-2 border-dashed',
              'border-gray-300 dark:border-gray-700',
              'text-gray-500 dark:text-gray-400',
              'hover:border-primary-500 hover:text-primary-500',
              'flex items-center justify-center gap-2',
              'transition-colors'
            )}
            aria-label="Add new column"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Column
          </button>
        </div>
      </div>

      <CardModal
        card={editingCard}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCard(null);
        }}
        onSave={handleSaveCard}
        columnId={targetColumnId || columns[0]?.id || ''}
      />

      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        aria-atomic="true"
      >
        {filters.search || filters.priorities.length > 0 || filters.tags.length > 0
          ? `Filters active: ${filters.search ? `search "${filters.search}"` : ''}${
              filters.priorities.length > 0
                ? `, priorities ${filters.priorities.join(', ')}`
                : ''
            }${filters.tags.length > 0 ? `, tags ${filters.tags.join(', ')}` : ''}`
          : 'No filters active'}
      </div>
    </div>
  );
}
```

### File: src/App.tsx

```tsx
import { useState, useEffect } from 'react';
import { BoardProvider, useBoard } from './context/BoardContext';
import { Board } from './components/Board';
import { SearchBar } from './components/SearchBar';
import { FilterPanel } from './components/FilterPanel';
import { clsx } from 'clsx';

function Header() {
  const { state, dispatch } = useBoard();
  const { isDarkMode, filters } = state;

  const hasActiveFilters =
    filters.search || filters.priorities.length > 0 || filters.tags.length > 0;

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 md:px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">TaskFlow</h1>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <SearchBar />
            <FilterPanel />
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <span className="text-xs text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-2 py-1 rounded">
                Filters active
              </span>
            )}
            <button
              onClick={() => dispatch({ type: 'TOGGLE_DARK_MODE' })}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function AppContent() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Board />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BoardProvider>
      <AppContent />
    </BoardProvider>
  );
}
```