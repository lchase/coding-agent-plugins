Click resolves a parameter in `Parameter.consume_value` (`src/click/core.py`).

The parser fills `opts` from the command line. If that entry is present, the source is `ParameterSource.COMMANDLINE`.

If the parser left the value unset, `consume_value` calls `value_from_envvar`. A non-empty result is kept with source `ParameterSource.ENVIRONMENT`.

If it is still unset, `consume_value` calls `Context.lookup_default`, which reads `Context.default_map`. A hit is source `ParameterSource.DEFAULT_MAP`.

If it is still unset, `consume_value` calls `get_default`, which returns the parameter's own default (including a callable default). That source is `ParameterSource.DEFAULT`.

`ParameterSource` orders sources from most explicit to least: `PROMPT`, `COMMANDLINE`, `ENVIRONMENT`, `DEFAULT_MAP`, `DEFAULT`. Prompting is a separate path on options and is not one of the four steps above.
