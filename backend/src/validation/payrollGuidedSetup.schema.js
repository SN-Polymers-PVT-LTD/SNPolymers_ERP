const { z } = require('zod');
const { statutory, draftConfiguration } = require('./payrollMasters.schema');

// Confirmation metadata belongs to the server, never to the request.
const { verification_status, advisor_name, verification_reference, verified_on, ...ruleShape } = statutory.shape;
const ruleInput = z.object({ ...ruleShape, configuration: draftConfiguration, reason: z.string().trim().max(2000) }).strict().superRefine((value, ctx) => {
  const configuration = value.configuration;
  const result = statutory.safeParse({
    ...value,
    reason: value.reason || 'Draft',
    configuration: configuration.included_components.length ? configuration : {
      ...configuration, included_components: ['PACKAGE_BALANCE'],
      excluded_components: configuration.excluded_components.filter(component => component !== 'PACKAGE_BALANCE'),
    },
    verification_status: 'UNVERIFIED', advisor_name: null, verification_reference: null, verified_on: null,
  });
  if (!result.success) for (const issue of result.error.issues) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});
const schemeNames = ['EPF', 'ESI', 'PT'];
const draft = z.object({
  state_id: z.uuid(),
  establishment: z.string().trim().min(1).max(120),
  effective_from: z.iso.date(),
  initial_setup: z.boolean().optional(),
  jurisdiction: z.string().trim().min(1).max(120).optional(),
  rules: z.object({ EPF: ruleInput.optional(), ESI: ruleInput.optional(), PT: ruleInput.optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  const rules = schemeNames.filter(name => value.rules[name]);
  for (const name of rules) {
    const rule = value.rules[name];
    if (rule.effective_to && rule.effective_to < rule.effective_from) ctx.addIssue({ code: 'custom', path: ['rules', name, 'effective_to'], message: 'Invalid rule effective range.' });
    if (rule.scheme !== name) ctx.addIssue({ code: 'custom', path: ['rules', name, 'scheme'], message: 'Rule scheme does not match its selection.' });
    if (rule.state_id !== value.state_id) ctx.addIssue({ code: 'custom', path: ['rules', name, 'state_id'], message: 'Rule must use the selected state.' });
    if (rule.establishment.trim().toLowerCase() !== value.establishment.toLowerCase()) ctx.addIssue({ code: 'custom', path: ['rules', name, 'establishment'], message: 'Rule must use the selected establishment.' });
    if (rule.effective_from > value.effective_from || (rule.effective_to && rule.effective_to < value.effective_from)) ctx.addIssue({ code: 'custom', path: ['rules', name], message: 'Rule must cover the company setup start date.' });
  }
});

const save = { body: z.object({ id: z.uuid().nullable(), expected_version: z.number().int().min(0), data: draft }).strict() };
const get = { params: z.object({ id: z.uuid() }).strict() };
const reviewBody = z.object({
  expected_version: z.number().int().positive(),
  initial_setup: z.boolean().default(false),
}).strict();
const review = { ...get, body: reviewBody };
const publish = { ...get, body: reviewBody.extend({
  review_token: z.string().regex(/^[a-f0-9]{64}$/),
  approval_reference: z.string().trim().min(1).max(2000),
  idempotency_key: z.uuid(),
}) };
const list = { query: z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() };
module.exports = { draft, save, get, review, publish, list };
