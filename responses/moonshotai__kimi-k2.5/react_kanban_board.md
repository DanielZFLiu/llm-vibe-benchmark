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
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
  },
  "dependencies": {
    "react": "^19.0.0-rc.1",
    "react-dom": "^19.0.0-rc.1",
    "react-markdown": "^9.0.1",
    "clsx": "^2.1.0",
    "nanoid": "^5.0.6"
  },
  "devDependencies": {
    "@types/react": "^19.0.0-rc.1",
    "@types/react-dom": "^19.0.0-rc.1",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^4.0.0-alpha.14",
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

### File: vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true
  },
  build: {
    target: 'esnext'
  }
});
```

### File: tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
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
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

### File: tailwind.config.ts

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        priority: {
          low: '#22c55e',
          medium: '#eab308',
          high: '#ef4444',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
};

export default config;
```

### File: postcss.config.js

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

### File: index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="TaskFlow - Personal Kanban Board" />
    <title>TaskFlow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### File: src/index.css

```css
@import "tailwindcss";

@theme {
  --color-priority-low: #22c55e;
  --color-priority-medium: #eab308;
  --color-priority-high: #ef4444;
}

@layer base {
  html {
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  
  body {
    @apply bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100;
  }
}

@layer utilities {
  .markdown-content ul {
    @apply list-disc pl-4;
  }
  .markdown-content ol {
    @apply list-decimal pl-4;
  }
  .markdown-content p {
    @apply mb-2;
  }
  .markdown-content a {
    @apply text-blue-600 dark:text-blue-400 underline;
  }
  .markdown-content strong {
    @apply font-bold;
  }
  .markdown-content em {
    @apply italic;
  }
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  @apply bg-gray-200 dark:bg-gray-800;
}

::-webkit-scrollbar-thumb {
  @apply bg-gray-400 dark:bg-gray-600 rounded-full;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-gray-500 dark:bg-gray-500;
}

/* Drag and drop visuals */
.dragging {
  opacity: 0.5;
  transform: rotate(2deg);
}

.drag-placeholder {
  @apply border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg;
  height: 100px;
  margin: 8px 0;
}

.card-enter {
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Focus visible styles */
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
[role="button"]:focus-visible {
  @apply outline-none ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900;
}
```

### File: src/types/index.ts

```typescript
export type Priority = 'low' | 'medium' | 'high';

export interface Card {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  tags: string[];
  createdAt: string;
  dueDate: string | null;
  columnId: string;
}

export interface Column {
  id: string;
  title: string;
  order: number;
}

export interface Filters {
  search: string;
  priorities: Priority[];
  tags: string[];
}

export interface BoardState {
  columns: Column[];
  cards: Card[];
  filters: Filters;
}

export type BoardAction =
  | { type: 'SET_COLUMNS'; payload: Column[] }
  | { type: 'SET_CARDS'; payload: Card[] }
  | { type: 'ADD_COLUMN'; payload: Column }
  | { type: 'DELETE_COLUMN'; payload: string }
  | { type: 'UPDATE_COLUMN'; payload: Column }
  | { type: 'REORDER_COLUMNS'; payload: Column[] }
  | { type: 'ADD_CARD'; payload: Card }
  | { type: 'DELETE_CARD'; payload: string }
  | { type: 'UPDATE_CARD'; payload: Card }
  | { type: 'MOVE_CARD'; payload: { cardId: string; targetColumnId: string; targetIndex?: number } }
  | { type: 'SET_FILTERS'; payload: Filters }
  | { type: 'SET_STATE'; payload: BoardState }
  | { type: 'LOAD_STATE'; payload: BoardState };

export interface HistoryEntry {
  state: BoardState;
  description: string;
  timestamp: number;
}

export interface DragState {
  type: 'card' | 'column' | null;
  id: string | null;
  sourceColumnId: string | null;
  overId: string | null;
  overColumnId: string | null;
}
```

### File: src/utils/id.ts

```typescript
import { nanoid } from 'nanoid';

export const generateId = (): string => nanoid(10);
```

### File: src/utils/date.ts

```typescript
export const formatDate = (dateString: string | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  }).format(date);
};

export const isOverdue = (dateString: string | null): boolean => {
  if (!dateString) return false;
  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};

export const getRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  
  if (diffInMinutes < 1) return 'just now';
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
  return `${Math.floor(diffInMinutes / 1440)}d ago`;
};
```

### File: src/utils/markdown.ts

```typescript
export const allowedMarkdownElements = [
  'p',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
  'br'
] as const;

export const markdownComponents = {
  a: ({ ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a 
      {...props} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300"
      onClick={(e) => e.stopPropagation()}
    />
  ),
};
```

### File: src/hooks/useLocalStorage.ts

```typescript
import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void, boolean] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        const parsed = JSON.parse(item) as T;
        setStoredValue(parsed);
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    setIsLoaded(true);
  }, [key]);

  const setValue = useCallback((value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key]);

  return [storedValue, setValue, isLoaded];
}
```

### File: src/hooks/useUndoHistory.ts

```typescript
import { useState, useCallback, useEffect } from 'react';
import type { BoardState, HistoryEntry } from '../types';

const MAX_HISTORY_SIZE = 20;

export function useUndoHistory(
  currentState: BoardState,
  setState: (state: BoardState) => void
) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const pushHistory = useCallback((description: string) => {
    setHistory(prev => {
      const newEntry: HistoryEntry = {
        state: currentState,
        description,
        timestamp: Date.now()
      };
      
      // Remove any future history if we're not at the end
      const trimmedHistory = prev.slice(0, historyIndex + 1);
      const newHistory = [newEntry, ...trimmedHistory].slice(0, MAX_HISTORY_SIZE);
      return newHistory;
    });
    setHistoryIndex(0);
  }, [currentState, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const entry = history[nextIndex];
      setState(entry.state);
      setHistoryIndex(nextIndex);
      return entry.description;
    }
    return null;
  }, [history, historyIndex, setState]);

  const redo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      const entry = history[nextIndex];
      setState(entry.state);
      setHistoryIndex(nextIndex);
      return entry.description;
    }
    return null;
  }, [history, historyIndex, setState]);

  const canUndo = historyIndex < history.length - 1;
  const canRedo = historyIndex > 0;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.metaKey || e.ctrlKey) && e.key === 'y') ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z')
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    historySize: history.length
  };
}
```

### File: src/hooks/useDragAndDrop.ts

```typescript
import { useState, useCallback } from 'react';
import type { DragState } from '../types';

export function useDragAndDrop() {
  const [dragState, setDragState] = useState<DragState>({
    type: null,
    id: null,
    sourceColumnId: null,
    overId: null,
    overColumnId: null
  });

  const setDraggedItem = useCallback((type: 'card' | 'column', id: string, sourceColumnId?: string) => {
    setDragState({
      type,
      id,
      sourceColumnId: sourceColumnId || null,
      overId: null,
      overColumnId: null
    });
  }, []);

  const setDragOver = useCallback((overId: string | null, overColumnId: string | null) => {
    setDragState(prev => ({
      ...prev,
      overId,
      overColumnId
    }));
  }, []);

  const clearDragState = useCallback(() => {
    setDragState({
      type: null,
      id: null,
      sourceColumnId: null,
      overId: null,
      overColumnId: null
    });
  }, []);

  return {
    dragState,
    setDraggedItem,
    setDragOver,
    clearDragState
  };
}
```

### File: src/hooks/useKeyboardShortcuts.ts

```typescript
import { useEffect, useCallback } from 'react';

interface UseKeyboardShortcutsProps {
  onMoveCardLeft?: () => void;
  onMoveCardRight?: () => void;
  onDeleteCard?: () => void;
  onEditCard?: () => void;
}

export function useKeyboardShortcuts({
  onMoveCardLeft,
  onMoveCardRight,
  onDeleteCard,
  onEditCard
}: UseKeyboardShortcutsProps, deps: React.DependencyList = []) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Alt + Arrow keys for moving cards
    if (e.altKey) {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onMoveCardLeft?.();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onMoveCardRight?.();
          break;
      }
    }
    
    // Delete key for deleting selected card (if not in input)
    if (e.key === 'Delete' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
      onDeleteCard?.();
    }
    
    // Enter for editing (if not in input)
    if (e.key === 'Enter' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
      onEditCard?.();
    }
  }, [onMoveCardLeft, onMoveCardRight, onDeleteCard, onEditCard]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, ...deps]);
}
```

### File: src/context/BoardContext.tsx

```typescript
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { BoardState, BoardAction, Card, Column, Filters } from '../types';
import { generateId } from '../utils/id';

const STORAGE_KEY = 'taskflow-board';

const defaultColumns: Column[] = [
  { id: 'col-1', title: 'To Do', order: 0 },
  { id: 'col-2', title: 'In Progress', order: 1 },
  { id: 'col-3', title: 'Done', order: 2 }
];

const initialState: BoardState = {
  columns: defaultColumns,
  cards: [],
  filters: {
    search: '',
    priorities: [],
    tags: []
  }
};

function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'SET_STATE':
    case 'LOAD_STATE':
      return action.payload;
    case 'SET_COLUMNS':
      return { ...state, columns: action.payload };
    case 'SET_CARDS':
      return { ...state, cards: action.payload };
    case 'ADD_COLUMN':
      return {
        ...state,
        columns: [...state.columns, { ...action.payload, order: state.columns.length }]
      };
    case 'DELETE_COLUMN':
      return {
        ...state,
        columns: state.columns.filter(col => col.id !== action.payload),
        cards: state.cards.filter(card => card.columnId !== action.payload)
      };
    case 'UPDATE_COLUMN':
      return {
        ...state,
        columns: state.columns.map(col => col.id === action.payload.id ? action.payload : col)
      };
    case 'REORDER_COLUMNS':
      return {
        ...state,
        columns: action.payload.map((col, idx) => ({ ...col, order: idx }))
      };
    case 'ADD_CARD':
      return { ...state, cards: [...state.cards, action.payload] };
    case 'DELETE_CARD':
      return {
        ...state,
        cards: state.cards.filter(card => card.id !== action.payload)
      };
    case 'UPDATE_CARD':
      return {
        ...state,
        cards: state.cards.map(card => card.id === action.payload.id ? action.payload : card)
      };
    case 'MOVE_CARD': {
      const { cardId, targetColumnId, targetIndex } = action.payload;
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return state;
      
      const otherCards = state.cards.filter(c => c.id !== cardId);
      const targetCards = otherCards.filter(c => c.columnId === targetColumnId);
      const otherColumnsCards = otherCards.filter(c => c.columnId !== targetColumnId);
      
      const updatedCard = { ...card, columnId: targetColumnId };
      
      if (targetIndex !== undefined) {
        targetCards.splice(targetIndex, 0, updatedCard);
      } else {
        targetCards.push(updatedCard);
      }
      
      return {
        ...state,
        cards: [...otherColumnsCards, ...targetCards]
      };
    }
    case 'SET_FILTERS':
      return { ...state, filters: action.payload };
    default:
      return state;
  }
}

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<BoardAction>;
  addColumn: (title: string) => void;
  deleteColumn: (id: string) => void;
  updateColumn: (column: Column) => void;
  addCard: (card: Omit<Card, 'id' | 'createdAt'>) => void;
  deleteCard: (id: string) => void;
  updateCard: (card: Card) => void;
  moveCard: (cardId: string, targetColumnId: string, targetIndex?: number) => void;
  reorderColumns: (columns: Column[]) => void;
  setFilters: (filters: Filters) => void;
  getUniqueTags: () => string[];
  isLoaded: boolean;
}

const BoardContext = createContext<BoardContextType | null>(null);

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, initialState);
  const [isLoaded, setIsLoaded] = React.useState(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as BoardState;
        dispatch({ type: 'LOAD_STATE', payload: { ...initialState, ...parsed } });
      }
    } catch (e) {
      console.error('Failed to load board state:', e);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('Failed to save board state:', e);
      }
    }
  }, [state, isLoaded]);

  const addColumn = useCallback((title: string) => {
    const newColumn: Column = {
      id: generateId(),
      title: title.trim(),
      order: state.columns.length
    };
    dispatch({ type: 'ADD_COLUMN', payload: newColumn });
  }, [state.columns.length]);

  const deleteColumn = useCallback((id: string) => {
    dispatch({ type: 'DELETE_COLUMN', payload: id });
  }, []);

  const updateColumn = useCallback((column: Column) => {
    dispatch({ type: 'UPDATE_COLUMN', payload: column });
  }, []);

  const addCard = useCallback((cardData: Omit<Card, 'id' | 'createdAt'>) => {
    const newCard: Card = {
      ...cardData,
      id: generateId(),
      createdAt: new Date().toISOString()
    };
    dispatch({ type: 'ADD_CARD', payload: newCard });
  }, []);

  const deleteCard = useCallback((id: string) => {
    dispatch({ type: 'DELETE_CARD', payload: id });
  }, []);

  const updateCard = useCallback((card: Card) => {
    dispatch({ type: 'UPDATE_CARD', payload: card });
  }, []);

  const moveCard = useCallback((cardId: string, targetColumnId: string, targetIndex?: number) => {
    dispatch({ 
      type: 'MOVE_CARD', 
      payload: { cardId, targetColumnId, targetIndex } 
    });
  }, []);

  const reorderColumns = useCallback((columns: Column[]) => {
    dispatch({ type: 'REORDER_COLUMNS', payload: columns });
  }, []);

  const setFilters = useCallback((filters: Filters) => {
    dispatch({ type: 'SET_FILTERS', payload: filters });
  }, []);

  const getUniqueTags = useCallback(() => {
    const tags = new Set<string>();
    state.cards.forEach(card => {
      card.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [state.cards]);

  return (
    <BoardContext.Provider
      value={{
        state,
        dispatch,
        addColumn,
        deleteColumn,
        updateColumn,
        addCard,
        deleteCard,
        updateCard,
        moveCard,
        reorderColumns,
        setFilters,
        getUniqueTags,
        isLoaded
      }}
    >
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

### File: src/components/SearchBar.tsx

```typescript
import React from 'react';
import { useBoard } from '../context/BoardContext';
import { Search } from 'lucide-react';

export const SearchBar: React.FC = () => {
  const { state, setFilters } = useBoard();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters({ ...state.filters, search: e.target.value });
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search cards..."
        value={state.filters.search}
        onChange={handleSearchChange}
        className="w-64 px-4 py-2 pl-10 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-gray-400"
        aria-label="Search cards"
      />
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
    </div>
  );
};

// Icon component inline since we can't import from lucide-react without installing
function Search({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
```

### File: src/components/FilterPanel.tsx

```typescript
import React from 'react';
import { useBoard } from '../context/BoardContext';
import type { Priority } from '../types';

const priorities: Priority[] = ['low', 'medium', 'high'];

export const FilterPanel: React.FC = () => {
  const { state, setFilters, getUniqueTags } = useBoard();

  const togglePriority = (priority: Priority) => {
    const newPriorities = state.filters.priorities.includes(priority)
      ? state.filters.priorities.filter(p => p !== priority)
      : [...state.filters.priorities, priority];
    setFilters({ ...state.filters, priorities: newPriorities });
  };

  const toggleTag = (tag: string) => {
    const newTags = state.filters.tags.includes(tag)
      ? state.filters.tags.filter(t => t !== tag)
      : [...state.filters.tags, tag];
    setFilters({ ...state.filters, tags: newTags });
  };

  const clearFilters = () => {
    setFilters({ search: '', priorities: [], tags: [] });
  };

  const hasActiveFilters = 
    state.filters.search || 
    state.filters.priorities.length > 0 || 
    state.filters.tags.length > 0;

  const allTags = getUniqueTags();

  if (allTags.length === 0 && state.filters.priorities.length === 0 && !state.filters.search) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Priority:</span>
        {priorities.map(priority => (
          <button
            key={priority}
            onClick={() => togglePriority(priority)}
            className={`
              px-3 py-1 rounded-full text-xs font-medium transition-colors
              ${state.filters.priorities.includes(priority)
                ? priority === 'high' 
                  ? 'bg-red-500 text-white'
                  : priority === 'medium'
                  ? 'bg-yellow-500 text-white'
                  : 'bg-green-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
              }
            `}
            aria-pressed={state.filters.priorities.includes(priority)}
          >
            {priority.charAt(0).toUpperCase() + priority.slice(1)}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Tags:</span>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`
                px-3 py-1 rounded-full text-xs font-medium transition-colors
                ${state.filters.tags.includes(tag)
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                }
              `}
              aria-pressed={state.filters.tags.includes(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="ml-auto text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Clear filters
        </button>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {hasActiveFilters ? 'Filters active' : 'No filters active'}
      </div>
    </div>
  );
};
```

### File: src/components/CardModal.tsx

```typescript
import React, { useState, useEffect } from 'react';
import type { Card, Priority } from '../types';
import { useBoard } from '../context/BoardContext';

interface CardModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: Card | null;
  columnId: string;
}

const priorities: Priority[] = ['low', 'medium', 'high'];

export const CardModal: React.FC<CardModalProps> = ({ isOpen, onClose, card, columnId }) => {
  const { addCard, updateCard } = useBoard();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [tags, setTags] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (card) {
        setTitle(card.title);
        setDescription(card.description);
        setPriority(card.priority);
        setTags(card.tags.join(', '));
        setDueDate(card.dueDate || '');
      } else {
        setTitle('');
        setDescription('');
        setPriority('medium');
        setTags('');
        setDueDate('');
      }
    }
  }, [isOpen, card]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    
    if (card) {
      updateCard({
        ...card,
        title: title.trim(),
        description: description.trim(),
        priority,
        tags: tagList,
        dueDate: dueDate || null
      });
    } else {
      addCard({
        title: title.trim(),
        description: description.trim(),
        priority,
        tags: tagList,
        dueDate: dueDate || null,
        columnId
      });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-modal-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-lg w-full p-6 shadow-xl">
        <h2 id="card-modal-title" className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          {card ? 'Edit Card' : 'New Card'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="card-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title *
            </label>
            <input
              id="card-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={100}
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              placeholder="Enter card title"
            />
          </div>

          <div>
            <label htmlFor="card-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description (Markdown supported)
            </label>
            <textarea
              id="card-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Add a description..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="card-priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Priority
              </label>
              <select
                id="card-priority"
                value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {priorities.map(p => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="card-due-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Due Date
              </label>
              <input
                id="card-due-date"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="card-tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tags (comma separated)
            </label>
            <input
              id="card-tags"
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              placeholder="bug, feature, urgent"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {card ? 'Save Changes' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

### File: src/components/Card.tsx

```typescript
import React, { useState, useRef } from 'react';
import type { Card as CardType } from '../types';
import { useBoard } from '../context/BoardContext';
import { formatDate, isOverdue, getRelativeTime } from '../utils/date';
import { markdownComponents } from '../utils/markdown';
import ReactMarkdown from 'react-markdown';

interface CardProps {
  card: CardType;
  isDragging?: boolean;
  isDimmed?: boolean;
  onDragStart: (e: React.DragEvent, cardId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}

export const Card: React.FC<CardProps> = ({
  card,
  isDragging = false,
  isDimmed = false,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onMoveLeft,
  onMoveRight
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey) {
      if (e.key === 'ArrowLeft' && onMoveLeft) {
        e.preventDefault();
        onMoveLeft();
      } else if (e.key === 'ArrowRight' && onMoveRight) {
        e.preventDefault();
        onMoveRight();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onEdit();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete();
    }
  };

  const priorityColors = {
    low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
  };

  const overdue = isOverdue(card.dueDate);

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={(e) => onDragStart(e, card.id)}
      onDragEnd={onDragEnd}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      tabIndex={0}
      role="button"
      aria-label={`${card.title}, priority ${card.priority}${overdue ? ', overdue' : ''}. Press Alt+Left/Right to move, Enter to edit, Delete to remove.`}
      className={`
        relative p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border 
        ${overdue ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}
        hover:shadow-md transition-all cursor-grab active:cursor-grabbing
        ${isDragging ? 'opacity-50 rotate-2' : ''}
        ${isDimmed ? 'opacity-40' : 'opacity-100'}
        ${isFocused ? 'ring-2 ring-blue-500' : ''}
        card-enter
      `}
    >
      {overdue && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" aria-hidden="true" />
      )}
      
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">
          {card.title}
        </h3>
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${priorityColors[card.priority]}`}>
          {card.priority}
        </span>
      </div>

      {card.description && (
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 line-clamp-3 markdown-content">
          <ReactMarkdown allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br']} components={markdownComponents}>
            {card.description}
          </ReactMarkdown>
        </div>
      )}

      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {card.tags.map(tag => (
            <span 
              key={tag} 
              className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
        <span>{getRelativeTime(card.createdAt)}</span>
        {card.dueDate && (
          <span className={`${overdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>
            Due: {formatDate(card.dueDate)}
          </span>
        )}
      </div>

      {(isFocused || isDragging) && (
        <div className="absolute -top-8 left-0 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-50">
          Alt+← → to move
        </div>
      )}
    </div>
  );
};
```

### File: src/components/Column.tsx

```typescript
import React, { useState, useRef } from 'react';
import type { Column as ColumnType, Card as CardType } from '../types';
import { useBoard } from '../context/BoardContext';
import { Card } from './Card';
import { CardModal } from './CardModal';

interface ColumnProps {
  column: ColumnType;
  cards: CardType[];
  isDimmed: boolean;
  dragState: {
    draggingCardId: string | null;
    overColumnId: string | null;
    overCardId: string | null;
  };
  onDragStart: (e: React.DragEvent, cardId: string, columnId: string) => void;
  onDragOver: (e: React.DragEvent, columnId: string, cardId?: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  onDragEnd: () => void;
  onColumnDragStart: (e: React.DragEvent, columnId: string) => void;
  onColumnDrop: (e: React.DragEvent, targetColumnId: string) => void;
  onMoveCard: (cardId: string, direction: 'left' | 'right') => void;
}

export const Column: React.FC<ColumnProps> = ({
  column,
  cards,
  isDimmed,
  dragState,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onColumnDragStart,
  onColumnDrop,
  onMoveCard
}) => {
  const { deleteColumn, updateColumn, state } = useBoard();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(column.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);

  const handleTitleSubmit = () => {
    if (title.trim()) {
      updateColumn({ ...column, title: title.trim() });
    } else {
      setTitle(column.title);
    }
    setIsEditingTitle(false);
  };

  const handleDelete = () => {
    if (cards.length > 0 && !showDeleteConfirm) {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
      return;
    }
    deleteColumn(column.id);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIndex(null);
    onDrop(e, column.id);
  };

  const handleDragOver = (e: React.DragEvent, index?: number) => {
    e.preventDefault();
    if (index !== undefined) setDragOverIndex(index);
    onDragOver(e, column.id, cards[index]?.id);
  };

  const handleAddCard = () => {
    setSelectedCard(null);
    setIsModalOpen(true);
  };

  const handleEditCard = (card: CardType) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const columnIndex = state.columns.findIndex(c => c.id === column.id);

  return (
    <div
      ref={columnRef}
      className={`
        flex-shrink-0 w-80 bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4
        flex flex-col max-h-full transition-opacity
        ${isDimmed ? 'opacity-50' : 'opacity-100'}
      `}
      onDragOver={(e) => handleDragOver(e)}
      onDrop={handleDrop}
      data-column-id={column.id}
    >
      <div
        className="flex items-center justify-between mb-4 cursor-move"
        draggable
        onDragStart={(e) => onColumnDragStart(e, column.id)}
        onDrop={(e) => onColumnDrop(e, column.id)}
        onDragOver={(e) => e.preventDefault()}
      >
        {isEditingTitle ? (
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={e => e.key === 'Enter' && handleTitleSubmit()}
            autoFocus
            className="flex-1 px-2 py-1 text-sm font-bold bg-white dark:bg-gray-700 rounded border border-blue-500 text-gray-900 dark:text-white"
            aria-label="Edit column title"
          />
        ) : (
          <h2 
            onClick={() => setIsEditingTitle(true)}
            className="font-bold text-gray-900 dark:text-white cursor-text select-none"
            aria-label={`Column: ${column.title}. Click to edit.`}
          >
            {column.title}
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({cards.length})
            </span>
          </h2>
        )}
        
        <div className="flex items-center gap-1">
          <button
            onClick={handleAddCard}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-400"
            aria-label="Add card"
            title="Add card"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
          <button
            onClick={handleDelete}
            className={`p-1 rounded ${showDeleteConfirm ? 'bg-red-100 text-red-600 dark:bg-red-900/30' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
            aria-label={showDeleteConfirm ? 'Confirm delete column' : 'Delete column'}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete column'}
          >
            <TrashIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-[100px]">
        {cards.map((card, index) => (
          <React.Fragment key={card.id}>
            {dragState.overColumnId === column.id && dragOverIndex === index && dragState.draggingCardId !== card.id && (
              <div className="drag-placeholder" aria-hidden="true" />
            )}
            <Card
              card={card}
              isDragging={dragState.draggingCardId === card.id}
              isDimmed={isDimmed}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onEdit={() => handleEditCard(card)}
              onDelete={() => {
                if (window.confirm('Delete this card?')) {
                  // Handle delete via context in parent or pass down
                  // For now, we'll handle this in Board