import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase-client';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

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
          query = query.eq('id', -1); // This will return no results
        }
      }
      
      if (region) {
        query = query.eq('region', region);
      }
      
      if (accountManager) {
        query = query.eq('account_manager', accountManager);
      }
      
      if (propertyType) {
        query = query.eq('property_type', propertyType);
      }
      
      if (company) {
        query = query.eq('company', company);
      }
      
      if (client) {
        query = query.eq('client', client);
      }
      
      // Add search functionality (searches name and client fields)
      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%, client.ilike.%${searchQuery}%`);
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
          totalsQuery = totalsQuery.eq('id', -1); // This will return no results
        }
      }
      
      if (region) {
        totalsQuery = totalsQuery.eq('region', region);
      }
      
      if (accountManager) {
        totalsQuery = totalsQuery.eq('account_manager', accountManager);
      }
      
      if (propertyType) {
        totalsQuery = totalsQuery.eq('property_type', propertyType);
      }
      
      if (company) {
        totalsQuery = totalsQuery.eq('company', company);
      }
      
      if (client) {
        totalsQuery = totalsQuery.eq('client', client);
      }
      
      if (searchQuery) {
        totalsQuery = totalsQuery.or(`name.ilike.%${searchQuery}%, client.ilike.%${searchQuery}%`);
      }
      
      const { data: totalsData, error: totalsError } = await totalsQuery;
      
      if (totalsError) {
        console.error('Error fetching totals:', totalsError);
        // Continue anyway, totals will be 0
      }
      
      // Calculate totals from the totals query
      const calculatedMonthlyInvoice = (totalsData || []).reduce((sum, prop) => sum + (prop.monthly_invoice || 0), 0);
      const calculatedCurrentHours = (totalsData || []).reduce((sum, prop) => sum + (prop.current_hours || 0), 0);
      const calculatedAdjustedHours = (totalsData || []).reduce((sum, prop) => {
        const hours = prop.adjusted_hours !== null && prop.adjusted_hours !== undefined ? 
          prop.adjusted_hours : prop.current_hours;
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
        
        const { data: accountManagers, error: accountManagersError } = await supabase
          .from('properties')
          .select('account_manager')
          .not('account_manager', 'is', null)
          .order('account_manager');
        
        if (accountManagersError) throw accountManagersError;
        
        const { data: propertyTypes, error: propertyTypesError } = await supabase
          .from('properties')
          .select('property_type')
          .not('property_type', 'is', null)
          .order('property_type');
        
        if (propertyTypesError) throw propertyTypesError;
        
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
        
        // Extract unique values
        const uniqueRegions = [...new Set(regions.map(r => r.region))].filter(Boolean);
        const uniqueAccountManagers = [...new Set(accountManagers.map(a => a.account_manager))].filter(Boolean);
        const uniquePropertyTypes = [...new Set(propertyTypes.map(p => p.property_type))].filter(Boolean);
        const uniqueCompanies = [...new Set(companies.map(c => c.company))].filter(Boolean);
        const uniqueClients = [...new Set(clients.map(c => c.client))].filter(Boolean);
        
        setRegions(uniqueRegions);
        setAccountManagers(uniqueAccountManagers);
        setPropertyTypes(uniquePropertyTypes);
        setCompanies(uniqueCompanies);
        setClients(uniqueClients);
      } catch (err) {
        console.error('Error fetching property options:', err);
        setError(err.message);
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

// Hook to fetch complexes (optionally filtered by branch)
export function useComplexes(branchId = null) {
  const [complexes, setComplexes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const fetchComplexes = useCallback(async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('complexes')
        .select('*')
        .order('name');
      
      // Filter by branch if provided
      if (branchId) {
        query = query.eq('branch_id', branchId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      setComplexes(data || []);
    } catch (err) {
      console.error('Error fetching complexes:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branchId]);
  
  useEffect(() => {
    fetchComplexes();
  }, [fetchComplexes]);
  
  const refetchComplexes = useCallback(async () => {
    return await fetchComplexes();
  }, [fetchComplexes]);
  
  return { complexes, loading, error, refetchComplexes };
}

// Function to create a complex
export async function createComplex(complexData) {
  try {
    const { data, error } = await supabase
      .from('complexes')
      .insert([complexData])
      .select();
      
    if (error) throw error;
    
    return { success: true, complex: data[0] };
  } catch (error) {
    console.error('Error creating complex:', error);
    return { success: false, error: error.message };
  }
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

// DASHBOARD OPERATIONS
// Function to get dashboard statistics
export async function getDashboardStats() {
  try {
    // Get property counts and totals
    const { data: properties, error: propError } = await supabase
      .from('properties')
      .select('monthly_invoice, current_hours, branch_id, crew_id');
      
    if (propError) throw propError;
    
    // Get crew counts
    const { count: crewCount, error: crewError } = await supabase
      .from('crews')
      .select('*', { count: 'exact' });
      
    if (crewError) throw crewError;
    
    // Get branch counts
    const { count: branchCount, error: branchError } = await supabase
      .from('branches')
      .select('*', { count: 'exact' });
      
    if (branchError) throw branchError;
    
    // Calculate totals
    const totalMonthlyInvoice = properties.reduce((sum, p) => sum + (p.monthly_invoice || 0), 0);
    const totalCurrentHours = properties.reduce((sum, p) => sum + (p.current_hours || 0), 0);
    
    // Count properties by branch
    const propertiesByBranch = {};
    properties.forEach(p => {
      if (p.branch_id) {
        propertiesByBranch[p.branch_id] = (propertiesByBranch[p.branch_id] || 0) + 1;
      }
    });
    
    return {
      success: true,
      stats: {
        totalProperties: properties.length,
        totalCrews: crewCount,
        totalBranches: branchCount,
        totalMonthlyInvoice,
        totalCurrentHours,
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
    // { Monday: [propIds], Tuesday: [propIds], ... Saturday: [propIds] }
    
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

// Hook to fetch crew schedule - Updated to include Saturday and refetch capability
export function useCrewSchedule(crewId) {
  const [schedule, setSchedule] = useState({
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    unassigned: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSchedule = useCallback(async () => {
    if (!crewId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // First, get the crew details to know its branch
      const { data: crewData, error: crewError } = await supabase
        .from('crews')
        .select('branch_id')
        .eq('id', crewId)
        .single();
      
      if (crewError) throw crewError;
      
      const branchId = crewData.branch_id;
      
      // Fetch all properties for this crew that are scheduled
      const { data: crewProperties, error: crewPropsError } = await supabase
        .from('properties')
        .select('*')
        .eq('crew_id', crewId)
        .not('service_day', 'is', null)
        .order('route_order');
      
      if (crewPropsError) throw crewPropsError;
      
      // Fetch ALL unassigned properties from the same branch
      const { data: unassignedProperties, error: unassignedError } = await supabase
        .from('properties')
        .select('*')
        .eq('branch_id', branchId)
        .is('service_day', null)
        .order('name');
      
      if (unassignedError) throw unassignedError;
      
      // Organize by service day - including Saturday
      const organized = {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
        unassigned: unassignedProperties || []
      };
      
      // Add scheduled properties to their respective days
      crewProperties.forEach(property => {
        if (property.service_day && organized[property.service_day]) {
          organized[property.service_day].push(property);
        }
      });
      
      setSchedule(organized);
    } catch (err) {
      console.error('Error fetching crew schedule:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [crewId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);
  
  // Expose refetch function
  const refetchSchedule = useCallback(async () => {
    return await fetchSchedule();
  }, [fetchSchedule]);
  
  return { schedule, loading, error, refetchSchedule };
}

// UPDATED: Function to save entire weekly schedule with auto-crew assignment - includes Saturday
export async function saveWeeklySchedule(crewId, weekSchedule) {
  try {
    console.log('saveWeeklySchedule called with:', { crewId, weekSchedule });
    
    // Validate input
    if (!crewId) {
      throw new Error('Crew ID is required');
    }
    
    // Extract scheduledPropertyIds if provided (properties that should be assigned to this crew)
    const scheduledPropertyIds = weekSchedule.scheduledPropertyIds || [];
    
    // Filter out any undefined, null, or invalid IDs from scheduled properties
    const validScheduledPropertyIds = scheduledPropertyIds.filter(id => {
      const isValid = id !== undefined && id !== null && !isNaN(parseInt(id));
      if (!isValid) {
        console.warn('Invalid scheduled property ID found:', id);
      }
      return isValid;
    });
    
    console.log('Properties to assign to crew:', validScheduledPropertyIds);
    
    // Step 1: If there are scheduled properties, assign them to this crew first
    if (validScheduledPropertyIds.length > 0) {
      console.log(`Assigning ${validScheduledPropertyIds.length} properties to crew ${crewId}`);
      
      const { error: assignError } = await supabase
        .from('properties')
        .update({ crew_id: crewId })
        .in('id', validScheduledPropertyIds);
      
      if (assignError) {
        console.error('Error assigning properties to crew:', assignError);
        throw assignError;
      }
      
      console.log('Properties successfully assigned to crew');
    }
    
    // Step 2: Clear service_day for ALL properties currently belonging to this crew
    const { error: clearAllError } = await supabase
      .from('properties')
      .update({ 
        service_day: null,
        route_order: 0 
      })
      .eq('crew_id', crewId);
    
    if (clearAllError) {
      console.error('Error clearing all crew properties:', clearAllError);
      throw clearAllError;
    }
    
    // Step 3: Now update each day's properties with their schedule - INCLUDING SATURDAY
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (const day of days) {
      const dayPropertyIds = weekSchedule[day] || [];
      
      // Filter and validate IDs for this day
      const validDayIds = dayPropertyIds.filter(id => {
        return id !== undefined && id !== null && !isNaN(parseInt(id));
      });
      
      if (validDayIds.length > 0) {
        // Update each property individually with its route order
        for (let i = 0; i < validDayIds.length; i++) {
          const propertyId = parseInt(validDayIds[i]);
          
          // Update both service_day and ensure it's assigned to this crew
          const { error: updateError } = await supabase
            .from('properties')
            .update({ 
              service_day: day,
              route_order: i + 1,
              crew_id: crewId  // Ensure the property is assigned to this crew
            })
            .eq('id', propertyId);
          
          if (updateError) {
            console.error(`Error updating property ${propertyId} for ${day}:`, updateError);
            throw updateError;
          }
        }
      }
    }
    
    // Handle unassigned properties - these should remain with crew but no service day
    // They're already set to null service_day from the clear operation above
    // The crew_id assignment happened in Step 1 if they were in scheduledPropertyIds
    
    console.log('Schedule saved successfully with crew assignments');
    return { success: true, message: 'Schedule saved and properties assigned successfully!' };
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

// Function to get schedule statistics - Updated to include Saturday
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
      Saturday: { count: 0, hours: 0, revenue: 0 },
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

// ============================================
// CREW DAY DATA OPERATIONS (Drive Time, etc.)
// ============================================

/**
 * Get drive time data for a specific crew
 * @param {number} crewId - The crew ID (integer)
 * @returns {Promise<Object>} - Object with drive times by day
 */
export async function getCrewDayData(crewId) {
  try {
    // Use authenticated client
    const supabase = createClientComponentClient();
    
    const { data, error } = await supabase
      .from('crew_day_data')
      .select('*')
      .eq('crew_id', crewId);
      
    if (error) throw error;
    
    // Convert array to object keyed by service_day for easier access
    const driveTimeByDay = {
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
      Saturday: 0
    };
    
    if (data) {
      data.forEach(record => {
        if (record.service_day && driveTimeByDay.hasOwnProperty(record.service_day)) {
          driveTimeByDay[record.service_day] = record.drive_time || 0;
        }
      });
    }
    
    return { success: true, driveTimeByDay };
  } catch (error) {
    console.error('Error fetching crew day data:', error);
    return { success: false, error: error.message, driveTimeByDay: {} };
  }
}

/**
 * Update or insert drive time for a crew on a specific day
 * @param {number} crewId - The crew ID (integer)
 * @param {string} serviceDay - The day of the week
 * @param {number} driveTime - The drive time in hours
 * @returns {Promise<Object>} - Success result
 */
export async function updateCrewDayDriveTime(crewId, serviceDay, driveTime) {
  try {
    // Use authenticated client - CRITICAL FIX
    const supabase = createClientComponentClient();
    
    // Validate inputs
    if (!crewId) {
      throw new Error('Crew ID is required');
    }
    
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (!validDays.includes(serviceDay)) {
      throw new Error('Invalid service day');
    }
    
    const parsedDriveTime = parseFloat(driveTime) || 0;
    
    // Use upsert to insert or update
    const { data, error } = await supabase
      .from('crew_day_data')
      .upsert(
        { 
          crew_id: crewId, 
          service_day: serviceDay, 
          drive_time: parsedDriveTime 
        },
        { 
          onConflict: 'crew_id,service_day',
          ignoreDuplicates: false 
        }
      )
      .select();
      
    if (error) throw error;
    
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating crew day drive time:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete drive time data for a crew on a specific day
 * @param {number} crewId - The crew ID (integer)
 * @param {string} serviceDay - The day of the week
 * @returns {Promise<Object>} - Success result
 */
export async function deleteCrewDayDriveTime(crewId, serviceDay) {
  try {
    // Use authenticated client
    const supabase = createClientComponentClient();
    
    const { error } = await supabase
      .from('crew_day_data')
      .delete()
      .eq('crew_id', crewId)
      .eq('service_day', serviceDay);
      
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting crew day drive time:', error);
    return { success: false, error: error.message };
  }
}

/**
 * React hook to fetch crew day data with auto-refresh
 * @param {number} crewId - The crew ID (integer)
 * @returns {Object} - Hook result with crewDayData (array), loading, error, and refetch
 */
export function useCrewDayData(crewId) {
  const [crewDayData, setCrewDayData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchCrewDayData = useCallback(async () => {
    if (!crewId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Use authenticated client
      const supabase = createClientComponentClient();
      
      const { data, error } = await supabase
        .from('crew_day_data')
        .select('*')
        .eq('crew_id', crewId);
      
      if (error) throw error;
      
      // Store as array for easier access in components
      setCrewDayData(data || []);
    } catch (err) {
      console.error('Error in useCrewDayData:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [crewId]);

  useEffect(() => {
    fetchCrewDayData();
  }, [fetchCrewDayData]);
  
  const refetchCrewDayData = useCallback(async () => {
    return await fetchCrewDayData();
  }, [fetchCrewDayData]);
  
  return { crewDayData, loading, error, refetchCrewDayData };
}

// ============================================
// REVENUE FORECAST OPERATIONS
// ============================================

/**
 * Hook to fetch revenue forecasts for a specific branch and year
 * @param {number} branchId - The branch ID
 * @param {number} year - The year to fetch forecasts for
 * @returns {Object} - Hook result with forecasts, loading, error, and refetch
 */
export function useRevenueForecasts(branchId, year) {
  const [forecasts, setForecasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchForecasts = useCallback(async () => {
    if (!branchId || !year) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      const supabaseClient = createClientComponentClient();
      
      const { data, error } = await supabaseClient
        .from('revenue_forecasts')
        .select('*')
        .eq('branch_id', branchId)
        .eq('year', year)
        .order('month');
      
      if (error) throw error;
      
      setForecasts(data || []);
    } catch (err) {
      console.error('Error fetching revenue forecasts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branchId, year]);

  useEffect(() => {
    fetchForecasts();
  }, [fetchForecasts]);
  
  const refetchForecasts = useCallback(async () => {
    return await fetchForecasts();
  }, [fetchForecasts]);
  
  return { forecasts, loading, error, refetchForecasts };
}

/**
 * Hook to fetch all revenue forecasts for a year (all branches)
 * @param {number} year - The year to fetch forecasts for
 * @returns {Object} - Hook result with forecasts grouped by branch
 */
export function useAllBranchForecasts(year) {
  const [forecasts, setForecasts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAllForecasts = useCallback(async () => {
    if (!year) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      const supabaseClient = createClientComponentClient();
      
      const { data, error } = await supabaseClient
        .from('revenue_forecasts')
        .select('*')
        .eq('year', year);
      
      if (error) throw error;
      
      // Group forecasts by branch_id
      const grouped = (data || []).reduce((acc, forecast) => {
        if (!acc[forecast.branch_id]) {
          acc[forecast.branch_id] = [];
        }
        acc[forecast.branch_id].push(forecast);
        return acc;
      }, {});
      
      setForecasts(grouped);
    } catch (err) {
      console.error('Error fetching all branch forecasts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchAllForecasts();
  }, [fetchAllForecasts]);
  
  const refetchForecasts = useCallback(async () => {
    return await fetchAllForecasts();
  }, [fetchAllForecasts]);
  
  return { forecasts, loading, error, refetchForecasts };
}

/**
 * Upsert a revenue forecast (create or update)
 * @param {number} branchId - The branch ID
 * @param {number} year - The year
 * @param {string} month - The month (Jan, Feb, etc.)
 * @param {number} forecastRevenue - The forecasted revenue amount
 * @param {number|null} actualFtes - The actual FTEs (optional)
 * @returns {Object} - Result with success status
 */
export async function upsertRevenueForecast(branchId, year, month, forecastRevenue, actualFtes = null) {
  try {
    const supabaseClient = createClientComponentClient();
    
    const { data, error } = await supabaseClient
      .from('revenue_forecasts')
      .upsert({
        branch_id: branchId,
        year: year,
        month: month,
        forecast_revenue: forecastRevenue,
        actual_ftes: actualFtes,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'branch_id,year,month'
      })
      .select();
    
    if (error) throw error;
    
    return { success: true, forecast: data[0] };
  } catch (error) {
    console.error('Error upserting revenue forecast:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Batch upsert multiple revenue forecasts for a branch
 * @param {number} branchId - The branch ID
 * @param {number} year - The year
 * @param {Object} monthlyData - Object with month keys and { revenue, actualFtes } values
 * @returns {Object} - Result with success status
 */
export async function batchUpsertForecasts(branchId, year, monthlyData) {
  try {
    const supabaseClient = createClientComponentClient();
    
    // Build array of forecast records
    const forecasts = Object.entries(monthlyData).map(([month, data]) => ({
      branch_id: branchId,
      year: year,
      month: month,
      forecast_revenue: data.revenue || 0,
      actual_ftes: data.actualFtes || null,
      actual_labor_cost: data.actualLaborCost || null,
      weeks_in_month: data.weeksInMonth || 4.33,
      actual_hours: data.actualHours || null,
      updated_at: new Date().toISOString()
    }));
    
    const { data, error } = await supabaseClient
      .from('revenue_forecasts')
      .upsert(forecasts, {
        onConflict: 'branch_id,year,month'
      })
      .select();
    
    if (error) throw error;
    
    return { success: true, forecasts: data };
  } catch (error) {
    console.error('Error batch upserting forecasts:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete all forecasts for a branch and year
 * @param {number} branchId - The branch ID
 * @param {number} year - The year
 * @returns {Object} - Result with success status
 */
export async function deleteForecasts(branchId, year) {
  try {
    const supabaseClient = createClientComponentClient();
    
    const { error } = await supabaseClient
      .from('revenue_forecasts')
      .delete()
      .eq('branch_id', branchId)
      .eq('year', year);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting forecasts:', error);
    return { success: false, error: error.message };
  }
}