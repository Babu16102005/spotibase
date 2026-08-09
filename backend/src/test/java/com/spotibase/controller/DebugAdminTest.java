package com.spotibase.controller;

import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.service.AdminService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@WebMvcTest(AdminController.class)
@Import(TestSecurityConfig.class)
class DebugAdminTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AdminService adminService;

    @Test
    void debugGetAllUsers() throws Exception {
        PagedResponse<UserResponse> paged = PagedResponse.<UserResponse>builder()
                .content(List.of(UserResponse.builder().id("user-1").username("alice").build()))
                .page(0).size(20).totalElements(1).totalPages(1).first(true).last(true).build();
        when(adminService.getAllUsers(anyInt(), anyInt()))
                .thenAnswer(inv -> {
                    System.out.println("DEBUG ARGS: page=" + inv.getArgument(0) + " size=" + inv.getArgument(1));
                    return paged;
                });

        MvcResult result = mockMvc.perform(get("/api/v1/admin/users")
                        .with(user(TestUsers.admin("admin-1"))))
                .andReturn();

        System.out.println("DEBUG STATUS: " + result.getResponse().getStatus());
        System.out.println("DEBUG BODY: [" + result.getResponse().getContentAsString() + "]");
        System.out.println("DEBUG EXCEPTION: " + result.getResolvedException());
    }
}
