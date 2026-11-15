# Domain: JVM / Java

Injected into **correctness** and **design** for `*.java` / `*.kt` and JVM build files. Adds language- and framework-specific traps to those lenses.

## → correctness

- **Primitive vs boxed.** `boolean` cannot say "unknown"; `Boolean` can. Passing a primitive where a callee treated `null` as "omit this" (an MDC/logging context, a partial update, a JSON field) turns "unknown" into an asserted `false` and can overwrite a correct outer value. Read the callee's null branch (`sentinel-ambiguity`).
- **Jackson inclusion.** `@JsonInclude(NON_DEFAULT)` compares against a freshly constructed instance, so changing a field initializer or the class-level inclusion silently changes what is emitted. `NON_NULL` on a primitive does nothing. Is there a test that pins the wire shape for both values?
- **Jackson access.** A field that should be server-only but is an ordinary property is accepted from every deserializer of that class. `@JsonProperty(access = READ_ONLY)` also blocks trusted internal round trips, so the fix may be a separate inbound DTO, not an annotation. Find every `readValue`/`convertValue`/consumer of the type (`ingress-gap`, feeds security).
- **Copy constructors and builders.** A new field added to a class: is it copied in the copy constructor, `toBuilder`, `with*` methods, `equals`/`hashCode`, and any manual mapper? Each one that misses it drops the value silently (`incomplete-propagation`).
- **Thread-local context.** MDC, request scopes, and thread locals do not follow work onto another executor or a reactive chain unless propagated, and a nested scope that sets a key can clobber the outer one on close.
- **Mapper and parser reuse.** A `new ObjectMapper()` per call is expensive and drifts from the app's configured mapper; use a shared instance. `readTree` ignores trailing tokens by default, so `"[1,2] garbage"` parses. An empty `catch (Exception)` around a parse drops the cause; catch the specific exception, keep it as the cause, and surface its message (`swallowed-exception`).
- **Boxed number widening.** `Number`/`Object` values from Jackson can be `Integer`, `Long`, `BigInteger`, `BigDecimal`, or `Double`. A cast or `instanceof` that is right for one silently rounds or overflows another. Read what the decoder actually produces.
- **Exception translation.** A rethrown exception without its cause hides the origin. A catch for one exception type leaves `ClassCastException`/`NullPointerException` to escape as a 500 (see the API checklist, `incomplete-error-mapping`).
- **Optional and nulls.** `Optional.get()` without a check; `Optional` used as a field or parameter; `@Nullable` contracts the caller ignores.

## → design

- **Source compatibility.** Changing a `public` method's parameter list in a shared module breaks every caller in other modules and repos; add an overload or deprecate first (`breaking-signature`). A trailing positional `boolean` after several loosely typed args invites swapped arguments; prefer the domain object or an enum.
- **Overload defaults.** A compatibility overload that fills in `false`/`null` makes forgetting the new argument compile cleanly. Say whether that default is safe for every future caller or whether the omission should be a compile error.
- **Dead or single-use overloads.** A public overload with no callers kept "for compatibility" and driving a null-key branch is a trap. Grep the repo (and say what you could not search); if nothing calls it, delete it and make the argument required.
- **Reflection in tests.** `getDeclaredMethod("privateThing")` fails only at runtime on rename and tests a seam the production code never calls (`wrong-test-boundary`, feeds tests).
