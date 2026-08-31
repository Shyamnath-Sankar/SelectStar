/**
 * Domain templates — auto-detect the user's domain (Sales, Marketing, HR, etc.)
 * from the schema's table names and provide:
 *   - Domain-specific starter questions (replace the generic 4-question list)
 *   - A pre-filled "first report" plan with sensible defaults
 *   - Domain-specific hidden-pattern detectors (not yet wired — future work)
 *
 * Detection is keyword-based: each template scores the schema's tables by
 * name overlap with the template's vocabulary. The highest-scoring template
 * wins if its score exceeds a small threshold; otherwise we return null
 * (generic mode).
 *
 * Adding a new template = add an entry to TEMPLATES. No other code changes.
 */
import type { SchemaSnapshot } from "@/lib/types";

export interface DomainTemplate {
  /** Stable id, e.g. "sales". */
  id: string;
  /** Display name, e.g. "Sales". */
  label: string;
  /** One-line description shown in the UI. */
  description: string;
  /** Keywords to match against table/column names (lower-cased). */
  keywords: string[];
  /**
   * Domain-specific starter questions. Receives the actual schema so it can
   * reference real table names.
   */
  starterQuestions: (schema: SchemaSnapshot) => string[];
  /**
   * Default report plan: focus, depth, sections. Lets the user click
   * "Generate Report" with sensible domain-specific defaults.
   */
  defaultReportPlan: {
    focus: string;
    depth: "quick" | "standard" | "deep";
    sections: string[];
  };
  /**
   * Icon name (matching lucide-react icon names). Rendered as a small badge
   * in the chat header so the user sees the detected domain at a glance.
   */
  icon: "shopping-cart" | "megaphone" | "users" | "box" | "wallet" | "heart-pulse" | "graduation-cap" | "truck";
}

export const TEMPLATES: DomainTemplate[] = [
  {
    id: "sales",
    label: "Sales",
    description: "Orders, customers, products, revenue.",
    keywords: ["order", "customer", "product", "revenue", "sale", "invoice", "payment", "cart", "shop"],
    starterQuestions: (s) => {
      const orders = s.tables.find((t) => /order/i.test(t.name));
      const customers = s.tables.find((t) => /customer/i.test(t.name));
      const products = s.tables.find((t) => /product/i.test(t.name));
      const out: string[] = [];
      if (orders) out.push("How many orders have we received, broken down by status?");
      if (customers) out.push("Who are our top 10 customers by total order value?");
      if (orders) out.push("Show me the distribution of order totals.");
      if (products) out.push("Which products have the lowest stock right now?");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "growth",
      depth: "standard",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "trends", "recommendations"],
    },
    icon: "shopping-cart",
  },
  {
    id: "marketing",
    label: "Marketing",
    description: "Campaigns, leads, channels, conversions.",
    keywords: ["campaign", "lead", "channel", "conversion", "click", "impression", "ad", "email", "subscriber", "audience", "attribution"],
    starterQuestions: (s) => {
      const campaigns = s.tables.find((t) => /campaign/i.test(t.name));
      const leads = s.tables.find((t) => /lead/i.test(t.name));
      const out: string[] = [];
      if (campaigns) out.push("Which campaigns drove the most conversions?");
      if (leads) out.push("How many leads came in this month, by source?");
      out.push("Show me conversion rate by channel.");
      out.push("Chart our top campaigns by ROI.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "growth",
      depth: "standard",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "trends", "segments", "recommendations"],
    },
    icon: "megaphone",
  },
  {
    id: "hr",
    label: "HR",
    description: "Employees, salaries, departments, attendance.",
    keywords: ["employee", "salary", "department", "attendance", "payroll", "leave", "headcount", "hr", "staff", "performance"],
    starterQuestions: (s) => {
      const emp = s.tables.find((t) => /employee|staff/i.test(t.name));
      const dept = s.tables.find((t) => /department/i.test(t.name));
      const out: string[] = [];
      if (emp) out.push("How many employees do we have, broken down by department?");
      if (emp) out.push("Show me the distribution of salaries.");
      if (dept) out.push("Which departments have grown the most this year?");
      out.push("Give me a statistical profile of the employees table.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "segments",
      depth: "standard",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "segments", "data_quality", "recommendations"],
    },
    icon: "users",
  },
  {
    id: "operations",
    label: "Operations",
    description: "Inventory, suppliers, shipments, logistics.",
    keywords: ["inventory", "stock", "supplier", "vendor", "shipment", "warehouse", "logistics", "delivery", "purchase_order"],
    starterQuestions: (s) => {
      const inv = s.tables.find((t) => /invent|stock|warehouse/i.test(t.name));
      const sup = s.tables.find((t) => /supplier|vendor/i.test(t.name));
      const out: string[] = [];
      if (inv) out.push("Which items have the lowest stock right now?");
      if (sup) out.push("Who are our top suppliers by order volume?");
      out.push("Show me inventory turnover by warehouse.");
      out.push("Chart the distribution of stock levels.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "anomalies",
      depth: "standard",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "segments", "data_quality", "recommendations"],
    },
    icon: "box",
  },
  {
    id: "finance",
    label: "Finance",
    description: "Transactions, accounts, budgets, expenses.",
    keywords: ["transaction", "account", "budget", "expense", "ledger", "invoice", "payment", "cost", "journal", "balance"],
    starterQuestions: (s) => {
      const tx = s.tables.find((t) => /transaction|ledger|journal/i.test(t.name));
      const exp = s.tables.find((t) => /expense|cost|budget/i.test(t.name));
      const out: string[] = [];
      if (tx) out.push("How many transactions have we recorded this month, by type?");
      if (exp) out.push("Show me the distribution of expense amounts.");
      out.push("Chart our top categories by total spend.");
      out.push("Give me a statistical profile of the transactions table.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "anomalies",
      depth: "deep",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "trends", "data_quality", "methodology", "recommendations"],
    },
    icon: "wallet",
  },
  {
    id: "healthcare",
    label: "Healthcare",
    description: "Patients, visits, diagnoses, treatments.",
    keywords: ["patient", "visit", "diagnosis", "treatment", "appointment", "clinic", "doctor", "medical", "prescription"],
    starterQuestions: (s) => {
      const pat = s.tables.find((t) => /patient/i.test(t.name));
      const vis = s.tables.find((t) => /visit|appointment/i.test(t.name));
      const out: string[] = [];
      if (pat) out.push("How many patients do we have, broken down by demographics?");
      if (vis) out.push("Show me visit volume over time.");
      out.push("Chart the distribution of diagnoses.");
      out.push("Give me a statistical profile of the patients table.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "anomalies",
      depth: "deep",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "segments", "data_quality", "recommendations"],
    },
    icon: "heart-pulse",
  },
  {
    id: "education",
    label: "Education",
    description: "Students, courses, enrollments, grades.",
    keywords: ["student", "course", "enrollment", "grade", "teacher", "class", "school", "assignment", "score"],
    starterQuestions: (s) => {
      const stu = s.tables.find((t) => /student/i.test(t.name));
      const crs = s.tables.find((t) => /course|class/i.test(t.name));
      const out: string[] = [];
      if (stu) out.push("How many students are enrolled, by grade level?");
      if (crs) out.push("Which courses have the most enrollments?");
      out.push("Show me the distribution of student grades.");
      out.push("Chart attendance over the term.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "segments",
      depth: "standard",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "segments", "trends", "recommendations"],
    },
    icon: "graduation-cap",
  },
  {
    id: "logistics",
    label: "Logistics",
    description: "Shipments, routes, carriers, deliveries.",
    keywords: ["shipment", "route", "carrier", "delivery", "fleet", "vehicle", "driver", "tracking", "order"],
    starterQuestions: (s) => {
      const shp = s.tables.find((t) => /shipment|delivery/i.test(t.name));
      const drv = s.tables.find((t) => /driver|vehicle|fleet/i.test(t.name));
      const out: string[] = [];
      if (shp) out.push("How many shipments are in transit right now, by status?");
      if (drv) out.push("Who are our most active drivers this week?");
      out.push("Show me on-time delivery rate by route.");
      out.push("Chart the distribution of delivery times.");
      out.push("Give me a full report on this data — surface hidden patterns and tell me what I should know.");
      return out.slice(0, 5);
    },
    defaultReportPlan: {
      focus: "anomalies",
      depth: "standard",
      sections: ["executive_summary", "key_metrics", "hidden_patterns", "trends", "data_quality", "recommendations"],
    },
    icon: "truck",
  },
];

/**
 * Detect the most likely domain for a schema. Returns the template or null
 * if no template scores high enough to override the generic starter list.
 *
 * Works for both multi-table SQL databases AND single-table CSV/XLSX
 * uploads — domain detection is based on table + column name keywords,
 * not on the number of tables.
 */
export function detectDomain(schema: SchemaSnapshot): DomainTemplate | null {
  if (!schema?.tables?.length) return null;

  let best: { template: DomainTemplate; score: number } | null = null;
  for (const template of TEMPLATES) {
    let score = 0;
    for (const t of schema.tables) {
      const nameToks = t.name.toLowerCase();
      for (const kw of template.keywords) {
        if (nameToks.includes(kw)) {
          score += 3;
          break;
        }
      }
      for (const col of t.columns) {
        const colName = col.name.toLowerCase();
        for (const kw of template.keywords) {
          if (colName.includes(kw)) {
            score += 1;
            break;
          }
        }
      }
    }
    if (!best || score > best.score) best = { template, score };
  }

  // Require at least 2 matches to override generic starters.
  if (!best || best.score < 2) return null;
  return best.template;
}

/**
 * Get starter questions for a schema — uses the detected domain's questions
 * if available, otherwise falls back to the generic heuristic list.
 */
export function getStarterQuestions(
  schema: SchemaSnapshot,
  fallbackFn: (s: SchemaSnapshot) => string[]
): { questions: string[]; domain: DomainTemplate | null } {
  const domain = detectDomain(schema);
  if (domain) {
    return { questions: domain.starterQuestions(schema), domain };
  }
  return { questions: fallbackFn(schema), domain: null };
}
