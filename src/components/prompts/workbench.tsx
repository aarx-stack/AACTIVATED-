"use client";

import { Bot, Copy, FilePlus2, History, Search, SendHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  chatAction,
  restoreVersionAction,
  saveTemplateAction,
  sendToAgentAction,
} from "@/app/(app)/prompts/actions";
import { ActionForm, selectClass, textareaClass } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  currentVersion: number;
  department: string | null;
}

export interface SelectedTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  currentVersion: number;
  versions: {
    version: number;
    changeNote: string | null;
    createdAt: string;
    createdBy: string | null;
  }[];
}

interface Message {
  role: "user" | "brain";
  text: string;
  at: string;
  template?: { name: string; description: string; body: string; variables: string[] } | null;
}

const VAR_RE = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/gi;

function variablesOf(body: string) {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]!.toLowerCase()))];
}

const label = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Shows the prompt with {{variables}} as highlighted chips (filled in when a value exists). */
function Highlighted({ body, values }: { body: string; values: Record<string, string> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1]!.toLowerCase();
    parts.push(body.slice(last, m.index));
    const value = values[name]?.trim();
    parts.push(
      <span
        key={`${m.index}`}
        className={cn(
          "rounded-[6px] px-1 py-px font-semibold",
          value ? "bg-success-soft text-success" : "fill-primary",
        )}
      >
        {value || `{{${name}}}`}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return <>{parts}</>;
}

export function PromptWorkbench({
  templates,
  selected,
  agents,
  q,
}: {
  templates: TemplateSummary[];
  selected: SelectedTemplate | null;
  agents: { id: string; label: string; available: boolean }[];
  q: string;
}) {
  const [draft, setDraft] = useState({
    name: selected?.name ?? "",
    description: selected?.description ?? "",
    body: selected?.body ?? "",
  });
  // Which saved template a save goes to: the open one, or "" for a new template.
  const [targetId, setTargetId] = useState(selected?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  // Controlled: React resets uncontrolled fields after each form action.
  const [agentId, setAgentId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const logRef = useRef<HTMLOListElement>(null);

  const variables = useMemo(() => variablesOf(draft.body), [draft.body]);
  const unsaved =
    !selected ||
    targetId !== selected.id ||
    draft.body.trim() !== selected.body.trim() ||
    draft.name.trim() !== selected.name.trim() ||
    draft.description.trim() !== selected.description.trim();

  function send(text: string) {
    const message = text.trim();
    if (message.length < 2 || pending) return;
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    const at = new Date().toISOString();
    setMessages((prev) => [...prev, { role: "user", text: message, at }]);
    setInput("");
    setChatError(null);
    start(async () => {
      const result = await chatAction({
        message,
        history,
        template: draft.body.trim() ? { name: draft.name || "Untitled", body: draft.body } : null,
      });
      if (!result.ok) {
        setChatError(result.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "brain",
          text: result.reply,
          template: result.template,
          at: new Date().toISOString(),
        },
      ]);
      requestAnimationFrame(() =>
        logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    });
  }

  function applyTemplate(t: NonNullable<Message["template"]>) {
    setDraft({ name: t.name, description: t.description, body: t.body });
    // A different template from the chat becomes a new template, never a rename of this one.
    setTargetId(selected && t.name.trim() === selected.name.trim() ? selected.id : "");
  }

  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
      {/* Chat */}
      <Card
        className="flex min-h-[360px] flex-col self-start p-5 2xl:min-h-[560px]"
        data-testid="brain-chat"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Chat with the Brain</h2>
            <p className="text-xs text-muted-foreground">
              Ask for a new template or changes to the one on the right.
            </p>
          </div>
          <Badge tone="success">
            <span className="size-1.5 rounded-pill bg-success" aria-hidden /> Brain online
          </Badge>
        </div>

        <ol
          ref={logRef}
          className="my-4 flex max-h-[520px] flex-1 flex-col gap-4 overflow-y-auto pr-1"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <li className="tile p-4 text-sm text-muted-foreground">
              Try: “Create a prompt for a short Instagram post about building a morning routine.”
            </li>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <li key={i} className="ml-8 flex flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">You · {time(m.at)}</span>
                <p className="rounded-card rounded-tr-[6px] fill-primary px-4 py-2.5 text-sm">
                  {m.text}
                </p>
              </li>
            ) : (
              <li key={i} className="mr-6 flex gap-2.5">
                <span className="mt-5 flex size-8 shrink-0 items-center justify-center rounded-pill border border-[var(--border-strong)] bg-info-soft">
                  <Bot className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Brain · {time(m.at)}</span>
                  <div className="flex flex-col gap-3 tile px-4 py-3 text-sm">
                    <p>{m.text}</p>
                    {m.template && (
                      <div className="flex items-center justify-between gap-3 rounded-control border border-[var(--border-strong)] p-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{m.template.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.template.variables.length} variables
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => applyTemplate(m.template!)}
                        >
                          Use template
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ),
          )}
          {pending && (
            <li className="text-sm text-muted-foreground" role="status">
              The Brain is writing…
            </li>
          )}
        </ol>

        {chatError && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {chatError}
          </p>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <label htmlFor="brain-message" className="sr-only">
            Message the Brain
          </label>
          <input
            id="brain-message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the Brain…"
            maxLength={2000}
            className="glass h-11 min-w-0 flex-1 rounded-control px-4 text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <Button type="submit" size="icon" disabled={pending} aria-label="Send message">
            <SendHorizontal aria-hidden />
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Improve this prompt", "Add variables", "Make it more specific"].map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={pending || !draft.body.trim()}
              onClick={() => send(chip)}
              className="rounded-pill border border-border px-3 py-1 text-xs font-semibold hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </Card>

      {/* Library + editor */}
      <div className="flex flex-col gap-5">
        <Card className="grid gap-5 p-5 lg:grid-cols-[250px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold">Prompt Template Library</h2>
              <p className="text-xs text-muted-foreground">Reusable templates for common work.</p>
            </div>
            <form
              action="/prompts"
              role="search"
              className="glass flex items-center gap-2 rounded-control px-3"
            >
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <label htmlFor="template-search" className="sr-only">
                Search templates
              </label>
              <input
                id="template-search"
                name="q"
                defaultValue={q}
                placeholder="Search templates…"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
            </form>
            <ul className="flex flex-col gap-2" data-testid="template-list">
              {templates.map((t) => {
                const active = selected?.id === t.id;
                return (
                  <li key={t.id}>
                    <Link
                      href={`/prompts?template=${t.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex flex-col rounded-control border px-3 py-2.5",
                        active
                          ? "border-[rgba(140,200,255,0.75)] fill-primary"
                          : "tile hover:shadow-glow-soft",
                      )}
                    >
                      <span className="text-sm font-semibold">{t.name}</span>
                      <span
                        className={cn(
                          "line-clamp-1 text-xs",
                          active ? "text-white/85" : "text-muted-foreground",
                        )}
                      >
                        {t.description}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {templates.length === 0 && (
                <li className="text-sm text-muted-foreground">No templates match.</li>
              )}
            </ul>
            <Button asChild variant="secondary" size="sm" className="self-start">
              <Link href="/prompts?template=new">
                <FilePlus2 aria-hidden /> New prompt
              </Link>
            </Button>
          </div>

          <div className="flex min-w-0 flex-col gap-4" data-testid="template-editor">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">{draft.name || "New prompt"}</h2>
                <p className="text-xs text-muted-foreground">
                  {draft.description || "Describe what this template is for."}
                </p>
              </div>
              {selected && targetId === selected.id ? (
                <Badge tone="info">
                  v{selected.currentVersion}
                  {unsaved ? " · unsaved changes" : ""}
                </Badge>
              ) : (
                <Badge tone="warning">New template</Badge>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-description">Description</Label>
                <Input
                  id="tpl-description"
                  value={draft.description}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="tpl-body">Prompt template</Label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  onClick={() => navigator.clipboard?.writeText(draft.body).catch(() => undefined)}
                >
                  <Copy className="size-3.5" aria-hidden /> Copy
                </button>
              </div>
              <textarea
                id="tpl-body"
                rows={8}
                value={draft.body}
                maxLength={6000}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                className={cn(textareaClass, "font-mono text-[13px] leading-relaxed")}
                placeholder="Write the prompt. Use {{variable_name}} for anything that changes."
              />
            </div>

            {variables.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold">Variables</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {variables.map((v) => (
                    <div key={v} className="flex flex-col gap-1">
                      <Label htmlFor={`var-${v}`} className="text-xs">
                        {label(v)}
                      </Label>
                      <Input
                        id={`var-${v}`}
                        value={values[v] ?? ""}
                        maxLength={500}
                        onChange={(e) => setValues({ ...values, [v]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            )}

            {draft.body.trim() && (
              <section aria-label="Preview" className="tile p-3">
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Preview
                </h3>
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  data-testid="prompt-preview"
                >
                  <Highlighted body={draft.body} values={values} />
                </p>
              </section>
            )}

            <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
              <ActionForm
                action={saveTemplateAction}
                submitLabel={
                  selected && targetId === selected.id ? "Save new version" : "Save template"
                }
                buttonVariant="secondary"
                testId="save-template"
              >
                <input type="hidden" name="templateId" value={targetId} />
                <input type="hidden" name="name" value={draft.name} />
                <input type="hidden" name="description" value={draft.description} />
                <input type="hidden" name="body" value={draft.body} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tpl-note">What changed? (optional)</Label>
                  <Input id="tpl-note" name="changeNote" maxLength={200} />
                </div>
              </ActionForm>

              <ActionForm
                action={sendToAgentAction}
                submitLabel="Send to agent"
                testId="send-to-agent"
              >
                <input type="hidden" name="templateId" value={selected?.id ?? ""} />
                {variables.map((v) => (
                  <input key={v} type="hidden" name={`var_${v}`} value={values[v] ?? ""} />
                ))}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="send-agent">Agent</Label>
                  <select
                    id="send-agent"
                    name="agentId"
                    className={selectClass}
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose an agent…
                    </option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={!a.available}>
                        {a.label}
                        {a.available ? "" : " (paused)"}
                      </option>
                    ))}
                  </select>
                </div>
                {(!selected || unsaved) && (
                  <p className="text-xs text-warning">
                    Save your changes first. Agents receive the saved version.
                  </p>
                )}
              </ActionForm>
            </div>
          </div>
        </Card>

        {selected && (
          <Card className="p-5" data-testid="version-history">
            <div className="mb-3 flex items-center gap-2">
              <History className="size-5" aria-hidden />
              <div>
                <h2 className="text-base font-semibold">Version History</h2>
                <p className="text-xs text-muted-foreground">
                  Every save is kept. Restoring copies an old version forward.
                </p>
              </div>
            </div>
            <ol className="flex flex-col gap-2">
              {selected.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 tile px-3 py-2.5 text-sm"
                >
                  <Badge tone={v.version === selected.currentVersion ? "info" : "outline"}>
                    v{v.version}
                  </Badge>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="min-w-0 flex-1">
                    {v.changeNote ?? "Updated"}
                    {v.createdBy && <span className="text-muted-foreground"> · {v.createdBy}</span>}
                  </span>
                  {v.version === selected.currentVersion ? (
                    <Badge tone="success">Current</Badge>
                  ) : (
                    <ActionForm
                      action={restoreVersionAction}
                      submitLabel="Restore"
                      buttonVariant="secondary"
                      className="flex-row items-center gap-2"
                    >
                      <input type="hidden" name="templateId" value={selected.id} />
                      <input type="hidden" name="version" value={v.version} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}

        <p className="flex items-center gap-2 text-xs text-subtle-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          Prompts stay inside the company. Anything an agent produces for the outside still goes
          through the Approval Queue.
        </p>
      </div>
    </div>
  );
}
