# AGENTS.md

## Purpose

This file defines how AI agents (Codex, ChatGPT, etc.) must behave when working on this Unity project.

Agents must follow these rules strictly. If a rule conflicts with generated output, the rule takes priority.

---

# 1. Global Behavior

* Act as a **senior Unity/C# engineer**
* Produce **production-ready code only**
* Do not generate pseudo-code or placeholders
* Do not guess missing requirements
* Ask for clarification when requirements are ambiguous
* Match **existing project patterns exactly**
* Prefer **clarity over brevity**

---

# 2. Code Style (STRICT - Derived from .editorconfig)

## Typing Rules

* NEVER use `var`
* ALWAYS use explicit types
* NEVER use implicit object creation (`new()`)

## Members & Syntax

* NEVER use expression-bodied members
* Use full property/method bodies
* Follow proper modifier ordering:
  public → private → protected → internal → static → etc.

## Bracing Style

* Use **K&R style braces**
* Do NOT place braces on a new line

Example:

```
if (condition) {
    Execute();
} else {
    Handle();
}
```

## Formatting

* Follow `.editorconfig` exactly
* Do not introduce new formatting styles
* Keep consistency with surrounding code

---

# 3. Naming Conventions

## General

* Public members → PascalCase
* Private fields → camelCase
* Constants → PascalCase

## Unity-Specific

* `[SerializeField] private` fields → camelCase
* Avoid Hungarian notation
* Use meaningful, domain-driven names

Example:

```
[SerializeField] private float moveSpeed;
public int CurrentLoad { get; private set; }
```

---

# 4. Unity Development Rules

## Architecture

* Prefer **composition over inheritance**
* Keep MonoBehaviours **thin and focused**
* Separate:

  * Logic
  * Data
  * Presentation

## Performance

* Avoid unnecessary allocations (GC-sensitive code)
* Avoid LINQ in hot paths
* Cache references where appropriate

## Serialization

* Use `[SerializeField]` instead of public fields
* Do not expose fields unless necessary

## Update Loops

* Avoid heavy logic inside `Update()`
* Use event-driven or state-driven systems when possible

---

# 5. System Design Guidelines

* Follow **SOLID principles**
* Write modular, extensible systems
* Avoid tight coupling
* Use clear interfaces where needed
* Design for scalability (especially simulation systems like loaders/trucks)

---

# 6. Error Handling

* Do not silently fail
* Validate inputs where necessary
* Use clear logging (Unity Debug or structured logging)

---

# 7. Output Expectations

When generating code:

* Provide **complete, compilable code**
* Do not omit required parts
* Do not include unnecessary comments
* Do not explain unless explicitly asked
* Do not include alternative implementations unless requested

---

# 8. Project Awareness

Before writing code:

1. Check `.editorconfig`
2. Analyze existing files
3. Match coding patterns already used
4. Reuse existing systems instead of creating duplicates

---

# 9. File Creation Rules

* Do not create new files unless necessary
* If creating a new file:

  * Follow project folder structure
  * Use clear, meaningful file names
* Keep classes **single-responsibility**

---

# 10. Refactoring Rules

When modifying existing code:

* Do not break existing behavior
* Preserve public APIs unless explicitly told otherwise
* Improve readability without changing logic
* Maintain backward compatibility

---

# 11. Disallowed Practices

* ❌ Using `var`
* ❌ Using `new()` shorthand
* ❌ Mixing coding styles
* ❌ Over-engineering simple systems
* ❌ Adding unused abstractions
* ❌ Writing incomplete logic

---

# 12. Preferred Patterns

* Explicit initialization
* Clear method responsibilities
* Data-driven systems where applicable
* Event/callback-based communication instead of polling

---

# 13. Communication Rules (for AI agents)

* Be concise and direct
* Avoid conversational fluff
* Focus on delivering correct implementation
* Ask questions only when necessary

---

# 14. Priority Order

When conflicts arise, follow this priority:

1. This file (AGENTS.md)
2. `.editorconfig`
3. Existing project code patterns
4. General best practices

---

# 15. Summary

This project prioritizes:

* Clarity
* Consistency
* Maintainability
* Performance

Agents must behave as disciplined contributors to a production codebase, not as generic code generators.

---

# 16. Documentation

Maintain, mirroring the practice used in the `LicenceRegistration` backend repo:

- docs/project-overview.md
- docs/architecture.md
- docs/roadmap.md
- docs/tasks.md
- docs/decisions.md
- docs/ai_handoff.md

## Before Coding

- Read architecture.md, roadmap.md, ai_handoff.md
- Summarize understanding before implementation

## During Coding

- Follow existing patterns (this file's rules 2-12 take priority over anything in docs/)
- Update tasks.md
- Update decisions.md for major decisions

## After Coding

- Update ai_handoff.md, record modified files and next recommended task

Assume another AI agent may continue the project tomorrow. Optimize for agent portability.

---
