import { randomUUID } from "node:crypto"

export interface PromptModelConfig {
  providerID: string
  modelID: string
  variant?: string
}

export interface CreateSessionInput {
  workflowId: string
  phase: string
  title: string
}

export interface InjectPromptInput {
  sessionId: string
  prompt: string
  agent?: string
  model?: PromptModelConfig
}

export interface InjectPromptResult {
  dispatchMode: string
  statusBefore: "running" | "idle" | "failed" | "missing"
}

export interface SessionEvent {
  type: string
  sessionId: string
  payload?: Record<string, unknown>
}

export interface OpencodeSessionClient {
  createSession(input: CreateSessionInput): Promise<{ sessionId: string }>
  ensureSessionReady(sessionId: string, title: string): Promise<void>
  injectPrompt(input: InjectPromptInput): Promise<InjectPromptResult>
  abort(sessionId: string): Promise<void>
  getSessionStatus(
    sessionId: string,
  ): Promise<"running" | "idle" | "failed" | "missing">
  streamEvents(sessionId: string): AsyncIterable<SessionEvent>
}

export interface PluginSdkClient {
  session: {
    create(args: { body: { title: string } }): Promise<unknown>
    promptAsync?(args: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        agent?: string
        model?: {
          providerID: string
          modelID: string
          variant?: string
        }
      }
    }): Promise<unknown>
    prompt(args: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        agent?: string
        model?: {
          providerID: string
          modelID: string
          variant?: string
        }
      }
    }): Promise<unknown>
    abort(args: { path: { id: string } }): Promise<unknown>
    status?(args: { path: { id: string } }): Promise<unknown>
    todo?: {
      list?: (args: { path: { id: string } }) => Promise<{ data?: Array<{ id: string; title?: string; completed?: boolean }> }>
      create?: (args: { path: { id: string }; body: { title: string; content?: string } }) => Promise<unknown>
      update?: (args: { path: { id: string; todoId: string }; body: { completed?: boolean; title?: string; content?: string } }) => Promise<unknown>
    }
  }
  event?: {
    subscribe?: () => Promise<{
      stream: AsyncIterable<{
        type: string
        properties?: Record<string, unknown>
      }>
    }>
  }
  tui?: {
    showToast?: (args: { body: { message: string; variant: string } }) => Promise<unknown>
  }
}

type InMemorySession = {
  sessionId: string
  title: string
  status: "running" | "idle" | "failed"
  prompts: string[]
}

export class InMemoryOpencodeSessionClient implements OpencodeSessionClient {
  private readonly sessions = new Map<string, InMemorySession>()
  private readonly eventQueue = new Map<string, SessionEvent[]>()

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    const sessionId = randomUUID()
    this.sessions.set(sessionId, {
      sessionId,
      title: input.title,
      status: "idle",
      prompts: [],
    })
    this.enqueue(sessionId, { type: "session.created", sessionId })
    return { sessionId }
  }

  async ensureSessionReady(sessionId: string, title: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        title,
        status: "idle",
        prompts: [],
      })
    }
  }

  async injectPrompt(input: InjectPromptInput): Promise<InjectPromptResult> {
    let session = this.sessions.get(input.sessionId)
    if (!session) {
      session = {
        sessionId: input.sessionId,
        title: "recovered",
        status: "idle",
        prompts: [],
      }
      this.sessions.set(input.sessionId, session)
    }

    session.status = "running"
    this.enqueue(input.sessionId, { type: "session.status", sessionId: input.sessionId, payload: { type: "busy" } })
    session.prompts.push(input.prompt)
    session.status = "idle"
    this.enqueue(input.sessionId, { type: "session.idle", sessionId: input.sessionId })
    return {
      dispatchMode: "in_memory_inline",
      statusBefore: "idle",
    }
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    session.status = "failed"
    this.enqueue(sessionId, { type: "session.error", sessionId, payload: { message: "aborted" } })
  }

  async getSessionStatus(
    sessionId: string,
  ): Promise<"running" | "idle" | "failed" | "missing"> {
    const session = this.sessions.get(sessionId)
    return session?.status ?? "missing"
  }

  async *streamEvents(_sessionId: string): AsyncIterable<SessionEvent> {
    while (true) {
      const queue = this.eventQueue.get(_sessionId) ?? []
      if (queue.length > 0) {
        const next = queue.shift()
        this.eventQueue.set(_sessionId, queue)
        if (next) {
          yield next
          continue
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  private enqueue(sessionId: string, event: SessionEvent): void {
    const queue = this.eventQueue.get(sessionId) ?? []
    queue.push(event)
    this.eventQueue.set(sessionId, queue)
  }
}

export class SdkOpencodeSessionClient implements OpencodeSessionClient {
  private readonly eventQueue = new Map<string, SessionEvent[]>()
  private readonly knownSessions = new Set<string>()
  private eventPumpStarted = false

  constructor(private readonly client: PluginSdkClient) {}

  private unwrapFields<T extends Record<string, unknown>>(value: unknown): T | null {
    if (!value || typeof value !== "object") {
      return null
    }
    if ("data" in value && value.data && typeof value.data === "object") {
      return value.data as T
    }
    return value as T
  }

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    this.ensureEventPump()
    const session = this.unwrapFields<{ id?: string }>(await this.client.session.create({
      body: { title: input.title },
    }))
    if (!session?.id) {
      throw new Error("OpenCode SDK createSession response did not include id")
    }
    this.knownSessions.add(session.id)
    this.enqueue(session.id, { type: "session.created", sessionId: session.id })
    return { sessionId: session.id }
  }

  async ensureSessionReady(sessionId: string, _title: string): Promise<void> {
    this.ensureEventPump()
    this.knownSessions.add(sessionId)
  }

  async injectPrompt(input: InjectPromptInput): Promise<InjectPromptResult> {
    this.ensureEventPump()
    this.knownSessions.add(input.sessionId)
    const request = {
      path: { id: input.sessionId },
      body: {
        parts: [
          {
            type: "text" as const,
            text: input.prompt,
          },
        ],
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.model
          ? {
              model: {
                providerID: input.model.providerID,
                modelID: input.model.modelID,
                ...(input.model.variant ? { variant: input.model.variant } : {}),
              },
        }
          : {}),
      },
    }
    const currentStatus = await this.getSessionStatus(input.sessionId)
    if (currentStatus === "running" && this.client.session.promptAsync) {
      await this.client.session.promptAsync(request)
      return {
        dispatchMode: "sdk_prompt_async",
        statusBefore: currentStatus,
      }
    }
    void this.client.session.prompt(request).catch((error: unknown) => {
      this.enqueue(input.sessionId, {
        type: "session.error",
        sessionId: input.sessionId,
        payload: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
    })
    return {
      dispatchMode: "sdk_prompt_background",
      statusBefore: currentStatus,
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.client.session.abort({ path: { id: sessionId } })
  }

  async getSessionStatus(sessionId: string): Promise<"running" | "idle" | "failed" | "missing"> {
    if (!this.client.session.status) {
      return this.knownSessions.has(sessionId) ? "idle" : "missing"
    }
    try {
      const status = this.unwrapFields<{ type?: string }>(await this.client.session.status({ path: { id: sessionId } }))
      if (status?.type === "busy" || status?.type === "retry" || status?.type === "running") {
        return "running"
      }
      return this.knownSessions.has(sessionId) ? "idle" : "missing"
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("404") || message.includes("not found")) {
        return "missing"
      }
      throw error
    }
  }

  async *streamEvents(sessionId: string): AsyncIterable<SessionEvent> {
    this.ensureEventPump()
    while (true) {
      const queue = this.eventQueue.get(sessionId) ?? []
      if (queue.length > 0) {
        const next = queue.shift()
        this.eventQueue.set(sessionId, queue)
        if (next) {
          yield next
          continue
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  private ensureEventPump(): void {
    if (this.eventPumpStarted || !this.client.event?.subscribe) {
      return
    }
    this.eventPumpStarted = true
    void this.startEventPump()
  }

  private async startEventPump(): Promise<void> {
    const subscription = await this.client.event?.subscribe?.()
    if (!subscription) {
      return
    }
    for await (const event of subscription.stream) {
      const sessionID = typeof event.properties?.sessionID === "string"
        ? event.properties.sessionID
        : undefined
      if (!sessionID || !this.knownSessions.has(sessionID)) {
        continue
      }
      if (event.type === "session.status" || event.type === "session.idle" || event.type === "session.error") {
        this.enqueue(sessionID, {
          type: event.type,
          sessionId: sessionID,
          ...(event.properties ? { payload: event.properties } : {}),
        })
      }
    }
  }

  private enqueue(sessionId: string, event: SessionEvent): void {
    const queue = this.eventQueue.get(sessionId) ?? []
    queue.push(event)
    this.eventQueue.set(sessionId, queue)
  }
}

type HttpClientOptions = {
  baseUrl: string
  password?: string
}

export class HttpOpencodeSessionClient implements OpencodeSessionClient {
  constructor(private readonly options: HttpClientOptions) {}

  async ensureSessionReady(_sessionId: string, _title: string): Promise<void> {}

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    const data = await this.request<{
      id?: string
      parentID?: string | null
      title?: string
    }>("POST", "/session", {
      title: input.title,
    })

    if (!data.id) {
      throw new Error("Opencode createSession response did not include id")
    }

    return { sessionId: data.id }
  }

  async injectPrompt(input: InjectPromptInput): Promise<InjectPromptResult> {
    const body: Record<string, unknown> = {
      parts: [
        {
          type: "text",
          text: input.prompt,
        },
      ],
    }

    if (input.agent) {
      body.agent = input.agent
    }
    if (input.model) {
      body.model = {
        providerID: input.model.providerID,
        modelID: input.model.modelID,
      }
      if (input.model.variant) {
        body.variant = input.model.variant
      }
    }

    await this.requestVoid("POST", `/session/${encodeURIComponent(input.sessionId)}/prompt_async`, body)
    return {
      dispatchMode: "http_prompt_async",
      statusBefore: "idle",
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.requestVoid("POST", `/session/${encodeURIComponent(sessionId)}/abort`)
  }

  async getSessionStatus(
    sessionId: string,
  ): Promise<"running" | "idle" | "failed" | "missing"> {
    const data = await this.request<Record<string, { type?: string }>>("GET", "/session/status")
    const info = data[sessionId]
    if (!info) {
      return "missing"
    }

    if (info.type === "busy" || info.type === "retry") {
      return "running"
    }

    return "idle"
  }

  async *streamEvents(_sessionId: string): AsyncIterable<SessionEvent> {
    const headers: Record<string, string> = {}
    if (this.options.password) {
      const token = Buffer.from(`:${this.options.password}`).toString("base64")
      headers.Authorization = `Basic ${token}`
    }

    const response = await fetch(new URL("/event", this.options.baseUrl), {
      headers,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Opencode event stream failed: ${response.status} ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }

      buffer += decoder.decode(result.value, { stream: true })
      const chunks = buffer.split("\n\n")
      buffer = chunks.pop() ?? ""

      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data:"))

        if (!dataLine) {
          continue
        }

        const raw = dataLine.slice(5).trim()
        if (!raw) {
          continue
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          continue
        }

        if (!parsed || typeof parsed !== "object") {
          continue
        }

        const event = parsed as {
          type?: string
          properties?: Record<string, unknown>
        }
        const sessionID = typeof event.properties?.sessionID === "string"
          ? event.properties.sessionID
          : undefined

        if (sessionID !== _sessionId || !event.type) {
          continue
        }

        const nextEvent: SessionEvent = {
          type: event.type,
          sessionId: sessionID,
        }
        if (event.properties) {
          nextEvent.payload = event.properties
        }
        yield nextEvent
      }
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.options.password) {
      const token = Buffer.from(`:${this.options.password}`).toString("base64")
      headers.Authorization = `Basic ${token}`
    }

    const response = await fetch(new URL(path, this.options.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Opencode request failed: ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as T
  }

  private async requestVoid(method: string, path: string, body?: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.options.password) {
      const token = Buffer.from(`:${this.options.password}`).toString("base64")
      headers.Authorization = `Basic ${token}`
    }

    const response = await fetch(new URL(path, this.options.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok && response.status !== 204) {
      throw new Error(`Opencode request failed: ${response.status} ${response.statusText}`)
    }
  }
}
