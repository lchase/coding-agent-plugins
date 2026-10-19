# Per-language filler message config

## Goal
Filler phrases sound natural in every supported language.

## Acceptance criteria
- [ ] AC1: config map language -> phrases via getFeatureTreatmentWithConfig
- [ ] AC2: falls back to en-US list when language missing

## Verify
mvn -ntp test -pl virtual-agent-fulfilment-multi-agent/multi-agent-respond -am
