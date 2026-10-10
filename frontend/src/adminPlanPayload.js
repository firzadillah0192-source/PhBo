/** Express plan PATCH treats ID/code as immutable and rejects extra DTO fields. */
export function adminPlanPayload(form, editing = false) {
 const body={name:form.name,description:form.description,monthly_ai_credits:Number(form.monthly_ai_credits),billing_period:form.billing_period,price_amount:form.price_amount === '' || form.price_amount == null ? null : Number(form.price_amount),currency:form.currency || null,is_active:form.is_active}
 return editing ? body : {id:form.id,code:form.code,...body}
}
