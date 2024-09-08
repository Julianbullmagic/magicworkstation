require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { processLead } = require('./leadCapture');

const supabase = createClient(process.env.SUPABASEURL, process.env.SUPABASEKEY);

async function updateOverlaps(event, otherEvents, eventType) {
  let processedEvent;
  if (eventType === 'Leads') {
    processedEvent = await processLead(event, supabase);
  } else {
    // For bookings, we need to process it as if it were a lead
    processedEvent = await processLead({
      ...event,
      num: 1 // Assuming a default value for 'num' which is required by processLead
    }, supabase);
  }

  const { error } = await supabase
    .from(eventType)
    .update({
      overlapping_booking_ids: processedEvent.overlapping_booking_ids,
      insufficient_travel_time_booking_ids: processedEvent.insufficient_travel_time_booking_ids
    })
    .eq('id', event.id);

  if (error) {
    console.error(`Error updating ${eventType}:`, error);
  }

  return [
    ...(processedEvent.overlapping_booking_ids || '').split(','),
    ...(processedEvent.insufficient_travel_time_booking_ids || '').split(',')
  ].filter(id => id !== '');
}

async function handleEventChange(eventType, eventId) {
  const { data: event, error: eventError } = await supabase
    .from(eventType)
    .select('*')
    .eq('id', eventId)
    .single();

  if (eventError) {
    console.error(`Error fetching ${eventType}:`, eventError);
    return;
  }

  const { data: otherEvents, error: otherEventsError } = await supabase
    .from(eventType === 'Leads' ? 'Bookings' : 'Leads')
    .select('*');

  if (otherEventsError) {
    console.error(`Error fetching ${eventType === 'Leads' ? 'Bookings' : 'Leads'}:`, otherEventsError);
    return;
  }

  const affectedIds = await updateOverlaps(event, otherEvents, eventType);

  // Update all affected events
  for (const affectedId of affectedIds) {
    const { data: affectedEvent } = await supabase
      .from(eventType === 'Leads' ? 'Bookings' : 'Leads')
      .select('*')
      .eq('id', affectedId)
      .single();

    if (affectedEvent) {
      await updateOverlaps(affectedEvent, [event], eventType === 'Leads' ? 'Bookings' : 'Leads');
    }
  }
}

async function handleEventDeletion(eventType, eventId) {
  const { data: event, error: eventError } = await supabase
    .from(eventType)
    .select('overlapping_booking_ids, insufficient_travel_time_booking_ids')
    .eq('id', eventId)
    .single();

  if (eventError) {
    console.error(`Error fetching ${eventType} for deletion:`, eventError);
    return;
  }

  const affectedIds = [
    ...(event.overlapping_booking_ids || '').split(','),
    ...(event.insufficient_travel_time_booking_ids || '').split(',')
  ].filter(id => id !== '');

  for (const affectedId of affectedIds) {
    await handleEventChange(eventType === 'Leads' ? 'Bookings' : 'Leads', affectedId);
  }
}

module.exports = {
  handleEventChange,
  handleEventDeletion
};