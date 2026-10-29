# CSR Work Flow Manager

Internal **Jira & 8:00 PM Daily Status Workflow Manager** built for an internal 20-member engineering and design team. Designed for **AWS Lambda** with **Amazon S3 as a Document Database** inside a **Private AWS VPC (Zero Internet Exposure)**.

---

## Key Features

1. **Main Page & Role-Based Login (`CSR Work Flow Manager`)**
   - Displays live server clock (`IST`), 8:00 PM Daily Status window status, Private VPC security posture, and role-based login for **Admin (Manager)** and **User (Team Member)**.
2. **Admin (Manager) Capabilities**
   - **User Management**: Add, edit, activate/deactivate, reset passwords, or delete internal team members (`db/users.json`).
   - **Assign Design & CSR Tasks**: Create tasks (`DESIGN_TASK`, `CSR_WORKFLOW`, `FEATURE`, `BUG`, `REVIEW`) with priorities, story points, and deadlines (`db/tasks.json`).
   - **Extend Task Timelines**: Extend task deadlines with mandatory reason tracking and full timeline extension history (`original_due_date` preserved).
   - **Unified Comments & Daily Status Visibility**: View all task comments, blockers, remarks, and daily status submissions across all team members.
   - **8:00 PM Email Reports**: View/trigger the consolidated HTML & Plaintext 8:00 PM Daily Status report where unsubmitted users are marked as **`NA`**.
3. **User (Team Member) Capabilities**
   - **Kanban & Task List**: View assigned tasks, deadlines, and extended timeline indicators; update task statuses (`TODO`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `DONE`).
   - **Blockers & Remarks**: Add comments, remarks, or flag `BLOCKER` issues on tasks, plus log hours worked.
   - **Pre-8:00 PM Daily Status Dashboard**: Submit daily tasks worked on, accomplishments, next plan, and blockers/remarks. Freely edit comments **before 8:00 PM (20:00)**. After 8:00 PM, editing locks (`HTTP 403`) and any unsubmitted user is automatically marked as **`NA`**.

---

## Quickstart (Run Locally with Local S3 Document DB Emulator)

```powershell
# 1. Start the FastAPI server locally (uses .s3_local_db/ with S3 ETag concurrency semantics)
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000

# 2. Open in browser:
# http://127.0.0.1:8000
```

### Default Seeded Accounts (for Local Testing)
| Role | Username | Password | Description |
| :--- | :--- | :--- | :--- |
| **ADMIN (Manager)** | `admin` | `Admin@123` | Rajesh Sharma — CSR Workflow Manager |
| **USER (Designer)** | `priya` | `User@123` | Priya Nair — Senior Product Designer (Submitted Today) |
| **USER (Engineer)** | `arjun` | `User@123` | Arjun Mehta — Senior UI Engineer (Not Submitted Yet -> becomes `NA` at 8 PM) |
| **USER (Designer)** | `vikram` | `User@123` | Vikram Singh — Interaction Designer (Has Active Task Blocker) |

### Run Automated End-to-End Tests
```powershell
python tests/test_csr_workflow.py
```

---

## Deploying to AWS (Private VPC — Zero Internet Exposure)

### Option A: AWS SAM (`template.yaml`)
```bash
sam build
sam deploy --guided \
  --parameter-overrides \
    VpcId=vpc-xxxxxxxx \
    PrivateSubnetIds=subnet-aaaa,subnet-bbbb \
    ApiGatewayVpcEndpointId=vpce-api-xxxx \
    S3VpcEndpointId=vpce-s3-xxxx \
    AdminReportEmails=manager@internal.csr.local \
    SesSenderEmail=csr-workflow-noreply@internal.csr.local
```

### Option B: Terraform (`infra/main.tf`)
```bash
cd infra
terraform init
terraform plan -var="jwt_secret_key=YOUR_HIGH_ENTROPY_SECRET"
terraform apply
```
