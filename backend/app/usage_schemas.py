from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class UsageOverviewResponse(BaseModel):
    total_users: int
    active_users: int
    successful_generations: int
    failed_generations: int
    credits_spent: int
    credits_refunded: int
    advanced_jobs: int
    provider_usage_jobs: int
    provider_account_jobs: int
    usage_coverage_percent: float
    provider_account_coverage_percent: float
    provider_distribution: list[dict[str, Any]]


class UserUsageItem(BaseModel):
    account_id: str
    email: str
    display_name: str | None
    account_status: str
    signup_date: datetime
    auth_provider: str
    plan: str | None
    subscription_status: str | None
    total_ai_credits_granted: int
    total_ai_credits_spent: int
    total_ai_credits_refunded: int
    current_remaining_credits: int
    successful_advanced_generations: int
    failed_advanced_generations: int
    total_basic_generations: int
    last_activity_at: datetime | None


class UserUsagePage(BaseModel):
    users: list[UserUsageItem]
    page: int
    page_size: int
    total: int
    pages: int


class ProviderRunResponse(BaseModel):
    id: str
    generation_job_id: str
    provider_name: str
    provider_model: str | None
    requested_model: str | None
    provider_reported_model: str | None
    provider_request_id: str | None
    router_request_id: str | None
    upstream_request_id: str | None
    provider_account_label: str | None
    provider_account_id: str | None
    provider_strategy_hint: str | None
    routing_strategy: str | None
    provider_usage: dict[str, Any] | None
    usage_available: bool | None
    input_tokens: int | None
    output_tokens: int | None
    input_text_tokens: int | None
    input_image_tokens: int | None
    output_image_tokens: int | None
    total_tokens: int | None
    billable_units: int | None
    provider_reported_cost: float | None
    upstream_status: str
    upstream_error_code: str | None
    upstream_error_message: str | None
    retry_count: int
    attempt_count: int | None
    failover_count: int | None
    request_started_at: datetime
    request_completed_at: datetime | None
    total_duration_ms: int | None
    router_duration_ms: int | None
    application_duration_ms: int | None
    created_at: datetime


class GenerationUsageItem(BaseModel):
    job_id: str
    account_id: str | None
    user_email: str | None
    guest_id: str | None
    mode: str
    experience_id: str | None
    template_id: str | None
    status: str
    credit_state: str
    provider: str | None
    model: str | None
    upstream_account: str | None
    requested_model: str | None = None
    provider_reported_model: str | None = None
    router_request_id: str | None = None
    upstream_request_id: str | None = None
    routing_strategy: str | None = None
    attempt_count: int | None = None
    retry_count: int | None = None
    failover_count: int | None = None
    total_tokens: int | None = None
    router_duration_ms: int | None = None
    application_duration_ms: int | None = None
    usage_available: bool
    duration_ms: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class GenerationUsagePage(BaseModel):
    generations: list[GenerationUsageItem]
    page: int
    page_size: int
    total: int
    pages: int


class ProviderOverviewResponse(BaseModel):
    total_advanced_jobs: int
    completed: int
    failed: int
    refunded: int
    average_duration_ms: float | None
    jobs_with_provider_usage: int
    jobs_with_provider_account_info: int
    configured_strategy: str | None
    observed_strategy_hints: list[str]
    routing_strategy_known: bool
    can_prove_round_robin: bool
    account_distribution_evidence: str
    strategy_message: str
    total_input_tokens: int | None = None
    total_output_tokens: int | None = None
    total_tokens: int | None = None
    average_attempts: float | None = None
    provider_cost_available: bool = False


class ProviderAccountDistributionItem(BaseModel):
    provider_account_label: str | None
    provider_account_id: str | None
    jobs_count: int
    success_count: int
    failed_count: int
    last_used_at: datetime
    total_tokens: int | None = None
    average_duration_ms: float | None = None
