import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../data/db';
import { alive, newId, save, softDelete } from '../../data/repo';
import { formatDate, today } from '../../domain/dates';
import { sortOpenTodos } from '../../domain/todos';
import type { Todo, TodoCategory, TodoPriority } from '../../domain/types';
import { Button, Card, cx, EmptyState, Field, Input, PageHeader, Select } from '../../components/ui';

const CATEGORIES: TodoCategory[] = ['Training', 'Alltag', 'Ernährung', 'Sonstiges'];
const PRIORITIES: TodoPriority[] = ['hoch', 'mittel', 'niedrig'];

const emptyDraft = { title: '', due: '', priority: 'mittel' as TodoPriority, category: 'Alltag' as TodoCategory, plannedTemplateId: '' };

export function TodosPage() {
  const navigate = useNavigate();
  const todos = useLiveQuery(async () => alive(await db.todos.toArray()), []);
  const templates = useLiveQuery(async () => alive(await db.templates.toArray()), []);
  const [draft, setDraft] = useState(emptyDraft);
  const [showDone, setShowDone] = useState(false);
  if (!todos || !templates) return null;

  const tplName = new Map(templates.map((t) => [t.id, t.name]));
  const open = sortOpenTodos(todos.filter((t) => t.done !== 1));
  const done = todos.filter((t) => t.done === 1).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const now = today();

  async function add() {
    const title = draft.title.trim() || (draft.plannedTemplateId ? `${tplName.get(draft.plannedTemplateId)}-Training` : '');
    if (!title) return;
    const todo: Omit<Todo, 'updatedAt' | 'deleted'> = {
      id: newId(),
      title,
      due: draft.due || undefined,
      priority: draft.priority,
      category: draft.plannedTemplateId ? 'Training' : draft.category,
      done: 0,
      plannedTemplateId: draft.plannedTemplateId || undefined,
    };
    await save(db.todos, todo);
    setDraft(emptyDraft);
  }

  async function toggle(t: Todo) {
    if (t.done !== 1 && t.plannedTemplateId) {
      // Geplante Einheit: Trainingsformular öffnen, beim Speichern wird abgehakt
      navigate(`/training/neu?vorlage=${t.plannedTemplateId}&todo=${t.id}`);
      return;
    }
    await save(db.todos, { ...t, done: t.done === 1 ? 0 : 1, doneAt: t.done === 1 ? undefined : Date.now() });
  }

  const row = (t: Todo) => {
    const overdue = t.done !== 1 && !!t.due && t.due < now;
    return (
      <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
        <button
          type="button"
          onClick={() => toggle(t)}
          aria-label={t.done === 1 ? 'Als offen markieren' : 'Als erledigt markieren'}
          className={cx('grid size-7 shrink-0 place-items-center rounded-full border-2', t.done === 1 ? 'border-accent bg-accent text-accent-fg' : 'border-line')}
        >
          {t.done === 1 && '✓'}
        </button>
        <div className="min-w-0 flex-1">
          <p className={cx('truncate', t.done === 1 && 'text-muted line-through')}>{t.title}</p>
          <p className="text-xs text-muted">
            {t.category}
            {t.plannedTemplateId && ` · Einheit: ${tplName.get(t.plannedTemplateId) ?? '–'}`}
            {t.due && <span className={cx(overdue && 'font-medium text-bad')}> · {overdue ? 'überfällig seit ' : 'fällig '}{formatDate(t.due)}</span>}
          </p>
        </div>
        {t.priority === 'hoch' && t.done !== 1 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-warn">hoch</span>}
        <Button variant="ghost" className="min-h-9 px-2" aria-label="Löschen" onClick={() => softDelete(db.todos, t.id)}>
          ✕
        </Button>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="To-Dos" subtitle={`${open.length} offen`} />
      <Card className="mb-5">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input placeholder="Neue Aufgabe …" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Fällig">
              <Input type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
            </Field>
            <Field label="Priorität">
              <Select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TodoPriority })}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Kategorie">
              <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as TodoCategory })}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Training planen">
              <Select value={draft.plannedTemplateId} onChange={(e) => setDraft({ ...draft, plannedTemplateId: e.target.value })}>
                <option value="">–</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" variant="primary" className="w-full">
            Hinzufügen
          </Button>
        </form>
      </Card>

      {open.length === 0 ? (
        <EmptyState title="Alles erledigt" text="Keine offenen Aufgaben. Plane z. B. dein nächstes Training über „Training planen“." />
      ) : (
        <ul className="space-y-2">{open.map(row)}</ul>
      )}

      {done.length > 0 && (
        <div className="mt-6">
          <Button variant="ghost" className="-ml-2" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Erledigte ausblenden' : `Erledigte anzeigen (${done.length})`}
          </Button>
          {showDone && <ul className="mt-2 space-y-2">{done.slice(0, 30).map(row)}</ul>}
        </div>
      )}
    </>
  );
}
