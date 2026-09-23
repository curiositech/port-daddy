---
license: Apache-2.0
visibility: private
name: recovery-app-legal-terms
description: Generate legally-sound terms of service, privacy policies, and medical disclaimers for recovery and wellness applications. Expert in HIPAA, GDPR, CCPA compliance. Activate on 'terms of service', 'privacy policy', 'legal terms', 'medical disclaimer', 'HIPAA', 'user agreement'. NOT for contract negotiation (use attorney), app development (use domain skills), or moderation (use recovery-community-moderator).
allowed-tools: Read, Write, Edit, WebSearch
metadata:
  category: Legal & Compliance
  tags:
  - legal-terms
  - privacy-policy
  - tos
  - recovery-app
  - compliance
  recognition-cues: []
  expectancies: []
  decision-cues: []
  adaptive-workarounds: []
  execution-pattern: sequential
  needs-cdm: true
io-contract:
  kind: tool
  inputs:
    - name: app_type
      type: enum
      required: true
      description: Category of recovery/wellness application
      values:
        - sobriety-tracking
        - peer-support
        - meditation-wellness
        - mental-health-journal
        - community-forum
        - hybrid
    - name: features
      type: array
      required: true
      description: List of app features that impact legal requirements
      values:
        - progress-tracking
        - photo-journal
        - peer-chat
        - crisis-detection
        - sponsor-sharing
        - analytics
        - motivational-content
        - community-posts
    - name: age_requirement
      type: enum
      required: true
      description: Minimum age for app users
      values:
        - under-13-allowed
        - 13-17-allowed
        - 18-plus-only
    - name: jurisdictions
      type: array
      required: true
      description: Primary jurisdictions where app operates (e.g., 'US', 'EU', 'CA')
      values:
        - US
        - EU
        - CA
        - UK
        - AU
    - name: data_types
      type: array
      required: true
      description: Categories of user data collected
      values:
        - account-profile
        - health-recovery-progress
        - community-messages
        - usage-analytics
        - location
        - biometric
    - name: document_type
      type: enum
      required: true
      description: Which legal document to generate
      values:
        - terms-of-service
        - privacy-policy
        - medical-disclaimer
        - user-agreement
        - all
    - name: reading_level
      type: enum
      required: false
      description: Target readability level for plain-English output
      values:
        - high-school
        - general-public
        - accessible
  outputs:
    - name: legal_document
      type: object
      description: Generated legal document(s) with sections, compliance notes, and quality gate checklist
    - name: compliance_summary
      type: object
      description: Structured compliance mapping showing GDPR/HIPAA/CCPA/COPPA applicability and legal basis selections
    - name: data_retention_schedule
      type: object
      description: Data retention periods by type with legal justification and deletion procedures
    - name: quality_checklist
      type: object
      description: Pass/fail checklist against 10 quality gates including crisis language, readability, non-stigmatizing tone
    - name: attorney_review_notes
      type: object
      description: Flagged sections requiring qualified attorney review before publication
---

# Recovery App Legal Terms

Generate legally-sound terms of service, privacy policies, and medical disclaimers for recovery and wellness applications that protect users while maintaining supportive, non-stigmatizing language.

## Decision Points

### GDPR Legal Basis Selection
```
Is user data processing?
├─ YES: What type of processing?
│   ├─ Service delivery (account, progress tracking)
│   │   └─ USE: Contract performance (Art 6.1b)
│   ├─ Analytics, improvements, marketing
│   │   ├─ High privacy impact? 
│   │   │   ├─ YES → USE: Explicit consent (Art 6.1a)
│   │   │   └─ NO → USE: Legitimate interest (Art 6.1f)
│   │   └─ INCLUDE: Opt-out mechanism
│   └─ Health/recovery data (special category)
│       └─ USE: Explicit consent (Art 9.2a) + health exception (Art 9.2h)
└─ NO: No legal basis needed
```

### Medical Disclaimer Requirements
```
Does app provide any of these?
├─ Progress tracking, sobriety counters → Include "not medical advice"
├─ Peer support, community features → Include "not therapy/counseling" 
├─ Motivational content, tips → Include "consult healthcare providers"
├─ Crisis language detection → MUST include 988 hotline reference
└─ Any recovery-related features → Include "no recovery guarantees"

Age verification needed?
├─ Under 13 allowed → COPPA compliance required
├─ 13-17 allowed → Parental consent mechanism
└─ 18+ only → Simple age verification sufficient
```

### Data Retention Decisions
```
What type of data?
├─ Account/profile data
│   └─ Retention: Until deletion requested or 6 years inactive
├─ Health/recovery progress
│   └─ Retention: User controlled + legal minimums (2-7 years)  
├─ Community posts/messages
│   └─ Retention: User controlled, immediate deletion option
└─ Usage analytics
    └─ Retention: Aggregate after 90 days, delete identifiers
```

## Failure Modes

### Missing Crisis Language
- **Detection**: Medical disclaimer lacks crisis intervention references
- **Symptoms**: No mention of 988 hotline, emergency services, or crisis resources
- **Fix**: Add mandatory crisis section: "If experiencing crisis, call/text 988 or 911"

### Over-Legalese Complexity  
- **Detection**: Flesch Reading Level > 12th grade, sentences > 25 words
- **Symptoms**: Users can't understand their rights, intimidating language
- **Fix**: Rewrite in plain English, add "What this means" explanations

### Schema Bloat
- **Detection**: Privacy policy > 5000 words, > 20 main sections
- **Symptoms**: Users skip reading, key info buried, compliance theater
- **Fix**: Use layered notices, highlight key points, group similar items

### Rubber Stamp Review
- **Detection**: Template used without app-specific customization
- **Symptoms**: Generic language, mismatched features, compliance gaps
- **Fix**: Audit each section against actual app functionality and data flows

### Jurisdiction Shopping
- **Detection**: Governing law clause chooses business-friendly jurisdiction unrelated to operations
- **Symptoms**: User confusion, potential enforceability issues  
- **Fix**: Use jurisdiction where business operates or users primarily located

## Worked Examples

### Privacy Policy for Sobriety Tracking App

**Scenario**: App tracks sobriety streaks, allows photo journals, has peer support chat

**Decision Process**:
1. **Data mapping**: Account data (contract), progress data (consent), chat (legitimate interest)
2. **Legal basis selection**: Mixed - contract for core features, consent for health data sharing
3. **Retention logic**: User controls progress data, chat auto-deletes after 1 year
4. **Crisis handling**: Photo journal could reveal crisis → add crisis detection language

**Expert catches**: Health data sharing with sponsors/counselors needs explicit opt-in
**Novice misses**: Treating all data the same, missing special category health protections

**Key sections generated**:
```markdown
## What Information We Collect
- Account info (email, username) - needed to provide service
- Sobriety progress (days sober, milestones) - you control sharing
- Chat messages - support community features, auto-delete after 1 year
```

## Quality Gates

- [ ] Medical disclaimer present with "not medical advice" language
- [ ] Age requirement clearly stated (18+ or parental consent process)
- [ ] Data retention periods defined for each data type
- [ ] Crisis intervention resources included (988 hotline minimum)
- [ ] GDPR legal basis specified for each processing purpose
- [ ] User deletion rights explained with process steps
- [ ] Security measures described (encryption, access controls)
- [ ] Contact information provided for privacy questions
- [ ] Plain English readability (Flesch score 60+, avg sentence < 20 words)
- [ ] Jurisdiction and governing law specified
- [ ] Non-stigmatizing language used throughout (no "addict", "substance abuser")

## NOT-FOR Boundaries

**Do NOT use this skill for**:
- Contract negotiation or business agreements → Use attorney consultation
- App development technical requirements → Use recovery-app-development skill  
- Content moderation policies → Use recovery-community-moderator skill
- Clinical/medical compliance beyond disclaimers → Use healthcare compliance expert
- Complex international law beyond GDPR/CCPA basics → Use international legal counsel
- Enforcement actions or legal disputes → Use litigation attorney

**Delegate when**:
- Client needs legal review before publishing → Refer to qualified attorney
- App handles payments/subscriptions → Add e-commerce legal specialist
- Integration with healthcare systems → Add HIPAA compliance expert
- Multi-jurisdiction complex compliance → Add international legal team
## Imported bundle navigation

These preserved source files add depth when their stated topic is needed.

- [docs/MEDICAL_DISCLAIMER.md](docs/MEDICAL_DISCLAIMER.md) — Medical Disclaimer.
- [docs/PRIVACY_POLICY_TEMPLATE.md](docs/PRIVACY_POLICY_TEMPLATE.md) — Privacy Policy Template.
- [docs/TERMS_OF_SERVICE_TEMPLATE.md](docs/TERMS_OF_SERVICE_TEMPLATE.md) — Terms of Service Template.
- [scripts/compliance_checklist.py](scripts/compliance_checklist.py) — Required phrases for medical disclaimer.
