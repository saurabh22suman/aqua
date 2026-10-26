import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Menu } from "@/components/ui/Menu";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  resolveTerm,
  type TerminologyState,
} from "@/lib/terminology/keys";

// UI foundation — the component fixture.
//
// One screen that shows every foundation primitive with synthetic data,
// so a reviewer can see the whole system at once instead of hunting
// for a page that happens to use a control. It is a TEST fixture: the
// component is rendered by tests/foundation/component-fixture.test.tsx,
// never mounted on a public route — the visual contract forbids
// exposing a debug gallery publicly.
//
// The data is synthetic and deliberately boring: no real member, no
// real money, no invented counts that could be mistaken for a report.
//
// The vocabulary goes through resolveTerm() like every other surface:
// "facility" and "batch" are preset vocabulary (a swim tenant calls a
// facility a lane), so the fixture renders whatever the tenant's
// terminology says.

export function ComponentFixture({
  terminology = { overrides: {}, locale: "en" },
}: {
  terminology?: TerminologyState;
}) {
  const facility = resolveTerm(terminology, "facility", 1);
  const batch = resolveTerm(terminology, "batch", 1);
  const member = resolveTerm(terminology, "member", 1);
  return (
    <div className="space-y-6 px-5 py-6" data-testid="component-fixture">
      <SectionHeader
        title="Foundation primitives"
        subtitle="Synthetic data only — this fixture is rendered by tests, not served."
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Actions</CardTitle>
            <CardDescription>One dominant action, everything else quieter.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="md">
            Collect payment
          </Button>
          <Button variant="secondary" size="md">
            Add member
          </Button>
          <Button variant="ghost" size="md">
            Capture enquiry
          </Button>
          <Button variant="destructive" size="md">
            Mark churned
          </Button>
          <Button variant="secondary" size="md" disabled>
            Unavailable
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Fields</CardTitle>
            <CardDescription>Label, description, error — beside the control.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="fixture-phone"
            label="Phone"
            description="Used for attendance reminders."
            required
          >
            {(field) => <Input {...field} defaultValue="98765 43210" />}
          </Field>
          <Field id="fixture-email" label="Email" error="Enter a valid email address.">
            {(field) => <Input {...field} invalid defaultValue="not-an-email" />}
          </Field>
          <Field id="fixture-notes" label="Notes">
            {(field) => <Textarea {...field} placeholder="Anything the desk should know" />}
          </Field>
          <div className="space-y-2">
            <Label htmlFor="fixture-facility">{facility}</Label>
            <Select id="fixture-facility" defaultValue="all">
              <option value="all">All facilities</option>
              <option value="pool-1">Pool 1</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Preferences</Label>
            <Checkbox defaultChecked>Include inactive members</Checkbox>
            <Switch label="Attendance reminders" checked={false} onCheckedChange={() => {}} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Status and feedback</CardTitle>
            <CardDescription>Status words carry the meaning; colour supports it.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="good">Paid</StatusBadge>
            <StatusBadge tone="warn">Due in 2 days</StatusBadge>
            <StatusBadge tone="late">Overdue</StatusBadge>
            <StatusBadge tone="neutral">Left</StatusBadge>
            <Badge>{batch}</Badge>
            <Badge variant="soft">New</Badge>
          </div>
          <InlineFeedback tone="neutral">
            Attendance reminders go out at 6:00 am.
          </InlineFeedback>
          <InlineFeedback tone="success">Payment recorded.</InlineFeedback>
          <InlineFeedback tone="error">
            Could not record the payment — the amount is missing.
          </InlineFeedback>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Navigation and overlays</CardTitle>
            <CardDescription>Tabs, menus, dialogs and the pager.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            label="Fees"
            value="dues"
            onValueChange={() => {}}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "dues", label: "Dues" },
              { value: "transactions", label: "Transactions" },
            ]}
          />
          <Menu
            label="Account"
            trigger="Account"
            items={[
              { label: "Profile", onSelect: () => {} },
              { label: "Appearance", onSelect: () => {} },
            ]}
          />
          <Dialog
            open={false}
            onOpenChange={() => {}}
            title="Mark churned"
            description="This cannot be undone."
            footer={<Button variant="secondary" size="md">Cancel</Button>}
          >
            <p>The {member} stops attending and their dues stop.</p>
          </Dialog>
          <Pagination page={2} pageCount={7} onPageChange={() => {}} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Empty state</CardTitle>
            <CardDescription>Built with the list, never after it.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No members yet"
            body="Import from a spreadsheet, or add your first member."
          />
        </CardContent>
      </Card>
    </div>
  );
}
