# Lets GitHub Actions push the service images to ECR without a stored access key: the workflow presents a short-lived
# OIDC token, and this role trusts it only for this repository, on main, on a version tag (v1.4.0) or in the `staging` environment.
variable "github_repository" {
  description = "GitHub repository (owner/name) whose workflows may assume the CI role."
  type        = string
  default     = "nielpattin/PharmacyCentral"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

resource "aws_iam_role" "github_ci" {
  name = "${local.environment_name}-github-ci"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:${var.github_repository}:ref:refs/heads/main",
            "repo:${var.github_repository}:ref:refs/tags/v*",
            "repo:${var.github_repository}:environment:staging",
          ]
        }
      }
    }]
  })
}

# Push only: the role can write images to this stack's repositories and nothing else.
resource "aws_iam_role_policy" "github_ci_ecr_push" {
  name = "ecr-push"
  role = aws_iam_role.github_ci.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "PushImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Resource = [for repository in aws_ecr_repository.service : repository.arn]
      },
    ]
  })
}
