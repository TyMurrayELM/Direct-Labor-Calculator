import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase-client';

// Hook to fetch properties with comprehensive filtering
export function useProperties({ 
  branchId, 
  crewId,
  crewType, // Added crew type parameter
  region,
  accountManager, 
  propertyType,
  company,
  client,
  searchQuery = '', // Added search query parameter
  page = 1, 
  pageSize = 50, // Default to 50 items per page
  sortBy = 'name',
  sortOrder = 'asc',
  fetchAllTotals = false // Flag to fetch totals for all properties
}) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [count, setCount] = useState(0);
  const [totalMonthlyInvoice, setTotalMonthlyInvoice] = useState(0);
  const [totalCurrentHours, setTotalCurrentHours] = useState(0);
  const [totalAdjustedHours, setTotalAdjustedHours] = useState(0);

  // Extract the fetchProperties logic into a separate function
  const fetchProperties = useCallback(async () => {
    try {
      setLoading(true);
      console.log("Fetching properties with filters:", { branchId, crewId, crewType, region, accountManager, propertyType, company, client, searchQuery });
      
      // Build query with filters
      let query = supabase
        .from('properties')
        .select('*, crews(id, name, crew_type, region, supervisor, size)', { count: 'exact' });
      
      // Apply filters - only add where clauses for non-empty filters
      if (branchId) {
        query = query.eq('branch_id', branchId);
      }
      
      if (crewId) {
        query = query.eq('crew_id', crewId);
      }
      
      if (crewType) {
        // First, get all crews matching the type
        const { data: matchingCrews } = await supabase
          .from('crews')
          .select('id')
          .eq('crew_type', crewType);
        
        if (matchingCrews && matchingCrews.length > 0) {
          // Then filter properties by those crew IDs
          const crewIds = matchingCrews.map(crew => crew.id);
          query = query.in('crew_id', crewIds);
        } else {
          // If no crews match the type, return no results
          query = query.eq('id', -1); // This will match no properties
        }
      }
      
      if (region) {
        query = query.ilike('region', `%${region}%`);
      }
      
      if (accountManager) {
        query = query.ilike('account_manager', `%${accountManager}%`);
      }
      
      if (propertyType) {
        query = query.eq('property_type', propertyType);
      }
      
      if (company) {
        query = query.ilike('company', `%${company}%`);
      }
      
      if (client) {
        query = query.ilike('client', `%${client}%`);
      }
      
      // Add search query filtering - FIXED SYNTAX
      if (searchQuery) {
        // The correct syntax for Supabase OR filters
        query = query.or([
          { name: { ilike: `%${searchQuery}%` } },
          { property_type: { ilike: `%${searchQuery}%` } },
          { account_manager: { ilike: `%${searchQuery}%` } },
          { region: { ilike: `%${searchQuery}%` } },
          { company: { ilike: `%${searchQuery}%` } },
          { client: { ilike: `%${searchQuery}%` } }
        ]);
      }
      
      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });
      
      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      
      query = query.range(from, to);
      
      // Execute query
      const { data, error, count } = await query;
      
      if (error) throw error;
      
      setProperties(data || []);
      setCount(count || 0);
      
      // Calculate totals across all pages by making a separate query without pagination
      let totalsQuery = supabase
        .from('properties')
        .select('monthly_invoice, current_hours, adjusted_hours, crews(crew_type)');
      
      // Apply the same filters
      if (branchId) {
        totalsQuery = totalsQuery.eq('branch_id', branchId);
      }
      
      if (crewId) {
        totalsQuery = totalsQuery.eq('crew_id', crewId);
      }
      
      if (crewType) {
        // First, get all crews matching the type
        const { data: matchingCrews } = await supabase
          .from('crews')
          .select('id')
          .eq('crew_type', crewType);
        
        if (matchingCrews && matchingCrews.length > 0) {
          // Then filter properties by those crew IDs
          const crewIds = matchingCrews.map(crew => crew.id);
          totalsQuery = totalsQuery.in('crew_id', crewIds);
        } else {
          // If no crews match the type, return no results
          totalsQuery = totalsQuery.eq('id', -1); // This will match no properties
        }
      }
      
      if (region) {
        totalsQuery = totalsQuery.ilike('region', `%${region}%`);
      }
      
      if (accountManager) {
        totalsQuery = totalsQuery.ilike('account_manager', `%${accountManager}%`);
      }
      
      if (propertyType) {
        totalsQuery = totalsQuery.eq('property_type', propertyType);
      }
      
      if (company) {
        totalsQuery = totalsQuery.ilike('company', `%${company}%`);
      }
      
      if (client) {
        totalsQuery = totalsQuery.ilike('client', `%${client}%`);
      }
      
      // Add the same search query to totals calculation - FIXED SYNTAX
      if (searchQuery) {
        totalsQuery = totalsQuery.or([
          { name: { ilike: `%${searchQuery}%` } },
          { property_type: { ilike: `%${searchQuery}%` } },
          { account_manager: { ilike: `%${searchQuery}%` } },
          { region: { ilike: `%${searchQuery}%` } },
          { company: { ilike: `%${searchQuery}%` } },
          { client: { ilike: `%${searchQuery}%` } }
        ]);
      }
      
      const { data: allData, error: totalsError } = await totalsQuery;
      
      if (totalsError) throw totalsError;
      
      // Calculate totals from all matching properties
      const calculatedMonthlyInvoice = allData.reduce((sum, prop) => sum + (prop.monthly_invoice || 0), 0);
      const calculatedCurrentHours = allData.reduce((sum, prop) => sum + (prop.current_hours || 0), 0);
      const calculatedAdjustedHours = allData.reduce((sum, prop) => {
        const hours = prop.adjusted_hours !== null ? prop.adjusted_hours : prop.current_hours;
        return sum + (hours || 0);
      }, 0);
      
      setTotalMonthlyInvoice(calculatedMonthlyInvoice);
      setTotalCurrentHours(calculatedCurrentHours);
      setTotalAdjustedHours(calculatedAdjustedHours);
      
      return true; // Indicate successful fetch
    } catch (err) {
      console.error('Error fetching properties:', err);
      setError(err.message);
      return false; // Indicate failed fetch
    } finally {
      setLoading(false);
    }
  }, [branchId, crewId, crewType, region, accountManager, propertyType, company, client, searchQuery, page, pageSize, sortBy, sortOrder]);
  
  // Create a refetch function that can be called from the component
  const refetchProperties = useCallback(async () => {
    return await fetchProperties();
  }, [fetchProperties]);
  
  // Initial fetch on dependencies change
  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);
  
  return { 
    properties, 
    loading, 
    error, 
    count, 
    totalPages: Math.ceil(count / pageSize),
    totalMonthlyInvoice,
    totalCurrentHours,
    totalNewHours: totalAdjustedHours,  // Use a more descriptive name here
    refetchProperties  // Expose the refetch function
  };
}

// Hook to fetch a single property
export function useProperty(id) {
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchProperty() {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        const { data, error } = await supabase
          .from('properties')
          .select('*, crews(id, name, crew_type, region, supervisor, size)')
          .eq('id', id)
          .single();
        
        if (error) throw error;
        
        setProperty(data);
      } catch (err) {
        console.error('Error fetching property:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchProperty();
  }, [id]);
  
  return { property, loading, error };
}

// Hook to fetch crews with the new fields
export function useCrews(branchId) {
  const [crews, setCrews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    async function fetchCrews() {
      try {
        setLoading(true);
        
        let query = supabase
          .from('crews')
          .select('id, name, crew_type, branch_id, region, supervisor, size, vehicle');
        
        if (branchId) {
          query = query.eq('branch_id', branchId);
        }
        
        const { data, error } = await query
          .order('crew_type', { ascending: true })
          .order('name', { ascending: true });
        
        if (error) throw error;
        
        setCrews(data || []);
      } catch (err) {
        console.error('Error fetching crews:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchCrews();
  }, [branchId]);
  
  return { crews, loading, error };
}

// Hook to fetch all unique regions, account managers, property types, companies, and clients
export function usePropertyOptions() {
  const [regions, setRegions] = useState([]);
  const [accountManagers, setAccountManagers] = useState([]);
  const [propertyTypes, setPropertyTypes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchOptions() {
      try {
        setLoading(true);
        
        // Get all distinct values for each field
        const { data: regions, error: regionsError } = await supabase
          .from('properties')
          .select('region')
          .not('region', 'is', null)
          .order('region');
        
        if (regionsError) throw regionsError;
        
        const { data: accountManagers, error: managersError } = await supabase
          .from('properties')
          .select('account_manager')
          .not('account_manager', 'is', null)
          .order('account_manager');
        
        if (managersError) throw managersError;
        
        const { data: propertyTypes, error: typesError } = await supabase
          .from('properties')
          .select('property_type')
          .not('property_type', 'is', null)
          .order('property_type');
        
        if (typesError) throw typesError;
        
        const { data: companies, error: companiesError } = await supabase
          .from('properties')
          .select('company')
          .not('company', 'is', null)
          .order('company');
        
        if (companiesError) throw companiesError;
        
        const { data: clients, error: clientsError } = await supabase
          .from('properties')
          .select('client')
          .not('client', 'is', null)
          .order('client');
        
        if (clientsError) throw clientsError;
        
        // Extract unique values and filter empty strings
        const uniqueRegions = [...new Set(regions.map(r => r.region).filter(Boolean))];
        const uniqueManagers = [...new Set(accountManagers.map(m => m.account_manager).filter(Boolean))];
        const uniqueTypes = [...new Set(propertyTypes.map(t => t.property_type).filter(Boolean))];
        const uniqueCompanies = [...new Set(companies.map(c => c.company).filter(Boolean))];
        const uniqueClients = [...new Set(clients.map(c => c.client).filter(Boolean))];
        
        setRegions(uniqueRegions);
        setAccountManagers(uniqueManagers);
        setPropertyTypes(uniqueTypes);
        setCompanies(uniqueCompanies);
        setClients(uniqueClients);
      } catch (err) {
        console.error('Error fetching property options:', err);
        setError(err.message);
        
        // Set empty arrays as fallback
        setRegions([]);
        setAccountManagers([]);
        setPropertyTypes([]);
        setCompanies([]);
        setClients([]);
      } finally {
        setLoading(false);
      }
    }
    
    fetchOptions();
  }, []);
  
  // Structure the return to match what the component expects
  return { 
    propertyTypes, 
    regions, 
    accountManagers, 
    companies, 
    clients, 
    loading, 
    error,
    // Also include the options object for backward compatibility
    options: {
      regions,
      accountManagers,
      propertyTypes,
      companies,
      clients
    }
  };
}

// Hook to fetch branches
export function useBranches() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    async function fetchBranches() {
      try {
        setLoading(true);
        
        const { data, error } = await supabase
          .from('branches')
          .select('*')
          .order('name');
        
        if (error) throw error;
        
        setBranches(data || []);
      } catch (err) {
        console.error('Error fetching branches:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchBranches();
  }, []);
  
  return { branches, loading, error };
}

// PROPERTY CRUD OPERATIONS
// Function to create property
export async function createProperty(propertyData) {
  try {
    const { data, error } = await supabase
      .from('properties')
      .insert([propertyData])
      .select();
      
    if (error) throw error;
    
    return { success: true, property: data[0] };
  } catch (error) {
    console.error('Error creating property:', error);
    return { success: false, error: error.message };
  }
}

// Function to update property
export async function updateProperty(id, propertyData) {
  try {
    const { error } = await supabase
      .from('properties')
      .update(propertyData)
      .eq('id', id);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error updating property:', error);
    return { success: false, error: error.message };
  }
}

// Function to delete property
export async function deleteProperty(id) {
  try {
    console.log(`Attempting to delete property with ID: ${id}`);
    
    // First, manually delete any property_updates entries to be absolutely sure
    const { error: updateRecordsError } = await supabase
      .from('property_updates')
      .delete()
      .eq('property_id', id);
    
    if (updateRecordsError) {
      console.warn('Warning when deleting property_updates:', updateRecordsError);
      // Continue anyway since we've set up CASCADE
    }
    
    // Now delete the property
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', id);
      
    if (error) {
      console.error('Error deleting property:', error);
      throw error;
    }
    
    console.log(`Successfully deleted property with ID: ${id}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting property:', error);
    return { success: false, error: error.message };
  }
}

// Function to update property hours
export async function updatePropertyHours(propertyId, newHours) {
  try {
    // Update the properties table with adjusted hours
    const { error: propertyError } = await supabase
      .from('properties')
      .update({ adjusted_hours: newHours })
      .eq('id', propertyId);
      
    if (propertyError) throw propertyError;
    
    // Then, log the update in property_updates table
    const { error: logError } = await supabase
      .from('property_updates')
      .insert({
        property_id: propertyId,
        new_hours: newHours
      });
      
    if (logError) throw logError;
    
    return { success: true };
  } catch (error) {
    console.error('Error updating property hours:', error);
    return { success: false, error: error.message };
  }
}

// Function to get crew details
export async function getCrewDetails(crewId) {
  try {
    const { data, error } = await supabase
      .from('crews')
      .select('*')
      .eq('id', crewId)
      .single();
      
    if (error) throw error;
    
    return { success: true, crew: data };
  } catch (error) {
    console.error('Error getting crew details:', error);
    return { success: false, error: error.message };
  }
}

// Function to update crew
export async function updateCrew(id, crewData) {
  try {
    const { error } = await supabase
      .from('crews')
      .update(crewData)
      .eq('id', id);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error updating crew:', error);
    return { success: false, error: error.message };
  }
}

// Function to create crew
export async function createCrew(crewData) {
  try {
    const { data, error } = await supabase
      .from('crews')
      .insert(crewData)
      .select();
      
    if (error) throw error;
    
    return { success: true, crew: data[0] };
  } catch (error) {
    console.error('Error creating crew:', error);
    return { success: false, error: error.message };
  }
}

// Function to get property count by crew
export async function getPropertyCountByCrew(crewId) {
  try {
    const { count, error } = await supabase
      .from('properties')
      .select('*', { count: 'exact' })
      .eq('crew_id', crewId);
    
    if (error) throw error;
    
    return { success: true, count };
  } catch (error) {
    console.error('Error getting property count:', error);
    return { success: false, error: error.message, count: 0 };
  }
}

// Function to delete a crew (with safety check)
export async function deleteCrew(crewId) {
  try {
    // First check if crew has properties
    const { count, error: countError } = await supabase
      .from('properties')
      .select('*', { count: 'exact' })
      .eq('crew_id', crewId);
    
    if (countError) throw countError;
    
    if (count > 0) {
      return { 
        success: false, 
        error: `Cannot delete crew with ${count} associated properties. Reassign properties first.` 
      };
    }
    
    // If no properties, delete the crew
    const { error } = await supabase
      .from('crews')
      .delete()
      .eq('id', crewId);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting crew:', error);
    return { success: false, error: error.message };
  }
}

// BRANCH OPERATIONS
// Function to create branch
export async function createBranch(branchData) {
  try {
    const { data, error } = await supabase
      .from('branches')
      .insert(branchData)
      .select();
      
    if (error) throw error;
    
    return { success: true, branch: data[0] };
  } catch (error) {
    console.error('Error creating branch:', error);
    return { success: false, error: error.message };
  }
}

// Function to update branch
export async function updateBranch(id, branchData) {
  try {
    const { error } = await supabase
      .from('branches')
      .update(branchData)
      .eq('id', id);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error updating branch:', error);
    return { success: false, error: error.message };
  }
}

// Function to get property count by branch
export async function getPropertyCountByBranch(branchId) {
  try {
    const { count, error } = await supabase
      .from('properties')
      .select('*', { count: 'exact' })
      .eq('branch_id', branchId);
    
    if (error) throw error;
    
    return { success: true, count };
  } catch (error) {
    console.error('Error getting property count:', error);
    return { success: false, error: error.message, count: 0 };
  }
}

// Function to get crew count by branch
export async function getCrewCountByBranch(branchId) {
  try {
    const { count, error } = await supabase
      .from('crews')
      .select('*', { count: 'exact' })
      .eq('branch_id', branchId);
    
    if (error) throw error;
    
    return { success: true, count };
  } catch (error) {
    console.error('Error getting crew count:', error);
    return { success: false, error: error.message, count: 0 };
  }
}

// Function to delete a branch (with safety check)
export async function deleteBranch(branchId) {
  try {
    // Check if branch has properties
    const { count: propertyCount, error: propertyError } = await supabase
      .from('properties')
      .select('*', { count: 'exact' })
      .eq('branch_id', branchId);
    
    if (propertyError) throw propertyError;
    
    if (propertyCount > 0) {
      return { 
        success: false, 
        error: `Cannot delete branch with ${propertyCount} associated properties. Reassign properties first.` 
      };
    }
    
    // Check if branch has crews
    const { count: crewCount, error: crewError } = await supabase
      .from('crews')
      .select('*', { count: 'exact' })
      .eq('branch_id', branchId);
    
    if (crewError) throw crewError;
    
    if (crewCount > 0) {
      return { 
        success: false, 
        error: `Cannot delete branch with ${crewCount} associated crews. Reassign crews first.` 
      };
    }
    
    // If no properties or crews, delete the branch
    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', branchId);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting branch:', error);
    return { success: false, error: error.message };
  }
}

// DASHBOARD STATISTICS
export async function getDashboardStats() {
  try {
    // Get total properties count
    const { count: totalProperties, error: propertiesError } = await supabase
      .from('properties')
      .select('*', { count: 'exact' });
      
    if (propertiesError) throw propertiesError;
    
    // Get total crews count
    const { count: totalCrews, error: crewsError } = await supabase
      .from('crews')
      .select('*', { count: 'exact' });
      
    if (crewsError) throw crewsError;
    
    // Get total branches count
    const { count: totalBranches, error: branchesError } = await supabase
      .from('branches')
      .select('*', { count: 'exact' });
      
    if (branchesError) throw branchesError;
    
    // Get sum of monthly invoices
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('properties')
      .select('monthly_invoice');
      
    if (invoiceError) throw invoiceError;
    
    const totalMonthlyInvoice = invoiceData.reduce((sum, prop) => sum + (prop.monthly_invoice || 0), 0);
    
    // Get properties by branch
    const { data: branchData, error: branchDistError } = await supabase
      .from('properties')
      .select('branch_id, branches!inner(name)');
      
    if (branchDistError) throw branchDistError;
    
    const propertiesByBranch = {};
    branchData.forEach(prop => {
      const branchName = prop.branches.name;
      propertiesByBranch[branchName] = (propertiesByBranch[branchName] || 0) + 1;
    });
    
    return {
      success: true,
      stats: {
        totalProperties,
        totalCrews,
        totalBranches,
        totalMonthlyInvoice,
        propertiesByBranch
      }
    };
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// SCHEDULE OPERATIONS
// ============================================

// Function to update property service day
export async function updatePropertyServiceDay(propertyId, serviceDay, routeOrder = 0) {
  try {
    const { data, error } = await supabase
      .from('properties')
      .update({ 
        service_day: serviceDay,
        route_order: routeOrder 
      })
      .eq('id', propertyId)
      .select();
      
    if (error) throw error;
    
    // Log the change in history
    await supabase
      .from('schedule_history')
      .insert({
        property_id: propertyId,
        new_service_day: serviceDay,
        notes: `Schedule updated via drag-drop interface`
      });
    
    return { success: true, property: data[0] };
  } catch (error) {
    console.error('Error updating property service day:', error);
    return { success: false, error: error.message };
  }
}

// Function to bulk update schedule for a crew
export async function updateCrewSchedule(crewId, scheduleData) {
  try {
    // scheduleData is an object like:
    // { Monday: [propIds], Tuesday: [propIds], ... }
    
    const updates = [];
    
    // First, clear all service days for this crew's properties
    await supabase
      .from('properties')
      .update({ service_day: null, route_order: 0 })
      .eq('crew_id', crewId);
    
    // Then set the new schedule
    for (const [day, propertyIds] of Object.entries(scheduleData)) {
      for (let i = 0; i < propertyIds.length; i++) {
        updates.push(
          updatePropertyServiceDay(propertyIds[i], day, i + 1)
        );
      }
    }
    
    await Promise.all(updates);
    
    return { success: true };
  } catch (error) {
    console.error('Error updating crew schedule:', error);
    return { success: false, error: error.message };
  }
}

// Hook to fetch crew schedule
export function useCrewSchedule(crewId) {
  const [schedule, setSchedule] = useState({
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    unassigned: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!crewId) {
      setLoading(false);
      return;
    }

    async function fetchSchedule() {
      try {
        setLoading(true);
        
        // Fetch all properties for this crew
        const { data, error } = await supabase
          .from('properties')
          .select('*')
          .eq('crew_id', crewId)
          .order('route_order');
        
        if (error) throw error;
        
        // Organize by service day
        const organized = {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          unassigned: []
        };
        
        data.forEach(property => {
          if (property.service_day && organized[property.service_day]) {
            organized[property.service_day].push(property);
          } else {
            organized.unassigned.push(property);
          }
        });
        
        setSchedule(organized);
      } catch (err) {
        console.error('Error fetching crew schedule:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchSchedule();
  }, [crewId]);
  
  return { schedule, loading, error };
}

// Function to save entire weekly schedule
export async function saveWeeklySchedule(crewId, weekSchedule) {
  try {
    // Start a transaction-like operation
    const updates = [];
    
    // Process each day
    for (const [day, properties] of Object.entries(weekSchedule)) {
      if (day === 'unassigned') continue; // Skip unassigned
      
      properties.forEach((property, index) => {
        updates.push({
          id: property.id,
          service_day: day,
          route_order: index + 1
        });
      });
    }
    
    // Update all properties in batch
    for (const update of updates) {
      const { error } = await supabase
        .from('properties')
        .update({
          service_day: update.service_day,
          route_order: update.route_order
        })
        .eq('id', update.id);
        
      if (error) throw error;
    }
    
    // Clear service day for unassigned properties
    const assignedIds = updates.map(u => u.id);
    const { error: clearError } = await supabase
      .from('properties')
      .update({ service_day: null, route_order: 0 })
      .eq('crew_id', crewId)
      .not('id', 'in', assignedIds.length > 0 ? assignedIds : [-1]);
      
    if (clearError) throw clearError;
    
    return { success: true, message: 'Schedule saved successfully!' };
  } catch (error) {
    console.error('Error saving weekly schedule:', error);
    return { success: false, error: error.message };
  }
}

// Function to duplicate schedule to another crew
export async function duplicateSchedule(fromCrewId, toCrewId) {
  try {
    // Get source crew's schedule
    const { data: sourceProperties, error: fetchError } = await supabase
      .from('properties')
      .select('service_day, route_order')
      .eq('crew_id', fromCrewId)
      .not('service_day', 'is', null);
      
    if (fetchError) throw fetchError;
    
    // Get target crew's properties
    const { data: targetProperties, error: targetError } = await supabase
      .from('properties')
      .select('id, name')
      .eq('crew_id', toCrewId);
      
    if (targetError) throw targetError;
    
    // Apply the schedule pattern to target crew
    // This is a simple example - you might want more sophisticated matching
    const updates = targetProperties.slice(0, sourceProperties.length).map((prop, index) => ({
      id: prop.id,
      service_day: sourceProperties[index]?.service_day,
      route_order: sourceProperties[index]?.route_order
    }));
    
    // Apply updates
    for (const update of updates) {
      await supabase
        .from('properties')
        .update({
          service_day: update.service_day,
          route_order: update.route_order
        })
        .eq('id', update.id);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error duplicating schedule:', error);
    return { success: false, error: error.message };
  }
}

// Function to clear a crew's schedule
export async function clearCrewSchedule(crewId) {
  try {
    const { error } = await supabase
      .from('properties')
      .update({ service_day: null, route_order: 0 })
      .eq('crew_id', crewId);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error clearing crew schedule:', error);
    return { success: false, error: error.message };
  }
}

// Function to get schedule statistics
export async function getScheduleStats(crewId) {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('service_day, current_hours, monthly_invoice')
      .eq('crew_id', crewId);
      
    if (error) throw error;
    
    const stats = {
      Monday: { count: 0, hours: 0, revenue: 0 },
      Tuesday: { count: 0, hours: 0, revenue: 0 },
      Wednesday: { count: 0, hours: 0, revenue: 0 },
      Thursday: { count: 0, hours: 0, revenue: 0 },
      Friday: { count: 0, hours: 0, revenue: 0 },
      unassigned: { count: 0, hours: 0, revenue: 0 }
    };
    
    data.forEach(property => {
      const day = property.service_day || 'unassigned';
      if (stats[day]) {
        stats[day].count++;
        stats[day].hours += property.current_hours || 0;
        stats[day].revenue += property.monthly_invoice || 0;
      }
    });
    
    return { success: true, stats };
  } catch (error) {
    console.error('Error getting schedule stats:', error);
    return { success: false, error: error.message };
  }
}

// Function to export schedule to CSV (bonus feature)
export async function exportScheduleToCSV(crewId, crewName) {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('name, address, service_day, current_hours, monthly_invoice')
      .eq('crew_id', crewId)
      .not('service_day', 'is', null)
      .order('service_day')
      .order('route_order');
      
    if (error) throw error;
    
    // Create CSV content
    const headers = ['Day', 'Property Name', 'Address', 'Hours', 'Monthly Invoice'];
    const rows = data.map(p => [
      p.service_day,
      p.name,
      p.address || '',
      p.current_hours,
      p.monthly_invoice
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${crewName}_schedule.csv`;
    a.click();
    
    return { success: true };
  } catch (error) {
    console.error('Error exporting schedule:', error);
    return { success: false, error: error.message };
  }
}