const { z } = require('zod');

const moneyField = z.number().refine((n) => Number.isFinite(n), {
  message: 'Expected a finite number'
});

const isoDateField = z.string().regex(/^\d{4}-\d{2}-\d{2}/, {
  message: 'Expected ISO date string'
});

const booleanField = z.boolean();

const permissionsField = z.record(z.unknown());

const authMeSerializationSchema = z.object({
  success: z.literal(true),
  user: z.object({
    id: z.string().uuid(),
    mobile_number: z.string(),
    role: z.string(),
    permissions: permissionsField.optional()
  }).passthrough()
});

const projectsHealthResponseSerializationSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({
    work_order_no: z.string(),
    physical_progress: moneyField.optional(),
    work_order_value: moneyField.optional(),
    health_score: moneyField.optional(),
    approved_requisitions_amount: moneyField.optional(),
    assigned_jes: z.array(z.object({
      mobile_number: z.string(),
      name: z.string()
    }).passthrough()).optional()
  }).passthrough())
});

const zoBalancesResponseSerializationSchema = z.object({
  success: z.literal(true),
  balances: z.array(z.object({
    zo_user_id: z.string(),
    available_balance: moneyField,
    updated_at: isoDateField
  }).passthrough())
});

const requisitionListItemSerializationSchema = z.object({
  requisition_amount: moneyField,
  approved_amount: moneyField.nullable().optional(),
  created_at: isoDateField,
  requisition_status: z.string()
}).passthrough();

const requisitionsListResponseSerializationSchema = z.object({
  success: z.literal(true),
  requisitions: z.array(requisitionListItemSerializationSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  })
});

const fundRequestListItemSerializationSchema = z.object({
  zo_fr_amount: moneyField,
  approve_ho_amount: moneyField.nullable().optional(),
  created_at: isoDateField.optional()
}).passthrough();

const fundRequestsListResponseSerializationSchema = z.object({
  success: z.literal(true),
  fundRequests: z.array(fundRequestListItemSerializationSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  })
});

const waterfallStageSchema = z.object({
  stage: z.string(),
  amount: moneyField
}).passthrough();

const executiveSummaryKpisSerializationSchema = z.object({
  totalWOValue: moneyField,
  zoAvailableBalance: moneyField
}).passthrough();

const hoChartDataSerializationSchema = z.object({
  success: z.literal(true),
  bubbleMatrix: z.array(z.unknown()),
  waterfallData: z.array(waterfallStageSchema),
  zonalHeatmap: z.array(z.unknown()),
  runwayTrend: z.array(z.unknown()),
  sCurveData: z.array(z.unknown()),
  revisionHeatmap: z.array(z.unknown()),
  departmentWiseEstimate: z.array(z.unknown()),
  physicalProgressMetrics: z.unknown(),
  jeVisitFrequencyMetrics: z.unknown(),
  executiveSummaryKpis: executiveSummaryKpisSerializationSchema,
  projectsList: z.array(z.unknown())
}).passthrough();

const hoActionableInsightsSerializationSchema = z.object({
  success: z.literal(true),
  runwayData: z.array(z.unknown()),
  stalledProjects: z.array(z.unknown()),
  highRevisionProjects: z.array(z.unknown())
});

function assertSerialization(schema, payload, label = 'payload') {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Serialization contract failed for ${label}: ${paths}`);
  }
  return result.data;
}

module.exports = {
  moneyField,
  isoDateField,
  booleanField,
  authMeSerializationSchema,
  projectsHealthResponseSerializationSchema,
  zoBalancesResponseSerializationSchema,
  requisitionListItemSerializationSchema,
  requisitionsListResponseSerializationSchema,
  fundRequestListItemSerializationSchema,
  fundRequestsListResponseSerializationSchema,
  hoChartDataSerializationSchema,
  hoActionableInsightsSerializationSchema,
  assertSerialization
};
