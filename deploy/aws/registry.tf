# One repository per backend service, plus ops and the two web apps. Tags are immutable: each release is a new image_tag.
resource "aws_ecr_repository" "service" {
  for_each = toset(concat(keys(local.backend_services), ["ops", "customer-web", "staff-web"]))

  name                 = "${local.environment_name}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}
